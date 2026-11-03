import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { systemPromptText } from '../harnesses/systemPrompt.js';
import { ACCIO_MCP_SERVER } from '../tools/tools.js';
import type { Harness, HarnessMessage, HarnessTurn } from './harness.js';

/** How long a stopped turn gets to wind down gracefully before its process is killed. */
const HARD_STOP_AFTER_MS = 3000;

/**
 * Runs a turn through the Claude Agent SDK, the way T3 does (ADR 0006). Harnesses
 * get every permission without prompts (ADR 0005). Settings come from the
 * profile's accio-owned config folder via CLAUDE_CONFIG_DIR (ADR 0003) and from
 * the checkout's own .claude folder and CLAUDE.md.
 */
export const claudeCode: Harness = {
  async *run({ cwd, prompt, sessionId, model, modelName, env, tools, signal }: HarnessTurn) {
    if (signal.aborted) return;
    const abortController = new AbortController();
    const stderr: string[] = [];
    const q = query({
      prompt,
      options: {
        cwd,
        model,
        env,
        abortController,
        resume: sessionId ?? undefined,
        includePartialMessages: true,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        settingSources: ['user', 'project', 'local'],
        ...(tools ? { mcpServers: { [ACCIO_MCP_SERVER]: { type: 'http' as const, url: tools.url, headers: { Authorization: tools.authorization } } } } : {}),
        systemPrompt: { type: 'preset', preset: 'claude_code', append: systemPromptText({ harnessId: 'claudeCode', model, modelName }) },
        stderr: (data) => {
          stderr.push(data);
          if (stderr.length > 50) stderr.shift();
        },
      },
    });

    // Give Claude a bounded chance to acknowledge interruption, then terminate
    // and await its cleanup before releasing the turn or exiting the server.
    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    let interruption: Promise<unknown> | undefined;
    let onAbort = () => {};
    const stopped = new Promise<'stopped'>((resolve) => {
      onAbort = () => {
        interruption = Promise.race([
          q.interrupt().catch(() => {}),
          new Promise<void>((done) => { stopTimer = setTimeout(done, HARD_STOP_AFTER_MS); }),
        ]);
        resolve('stopped');
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    });

    const it = q[Symbol.asyncIterator]();
    try {
      for (;;) {
        const next = it.next();
        next.catch(() => {}); // may reject after we stop listening
        const step = await Promise.race([next, stopped]);
        if (step === 'stopped' || step.done) return;
        yield step.value as HarnessMessage;
      }
    } catch (err) {
      if (signal.aborted) return;
      const detail = stderr.join('').trim().split('\n').slice(-5).join('\n');
      throw new Error(detail ? `${(err as Error).message}\n${detail}` : (err as Error).message);
    } finally {
      signal.removeEventListener('abort', onAbort);
      await interruption;
      clearTimeout(stopTimer);
      q.close();
      await q.return();
    }
  },
};

/** What this machine reports about Claude Code: the Agent SDK accio bundles. */
export async function claudeCodeInstall(): Promise<{ harnessId: 'claudeCode'; version: string | null }> {
  try {
    const entry = fileURLToPath(import.meta.resolve('@anthropic-ai/claude-agent-sdk'));
    const pkg = JSON.parse(await readFile(join(dirname(entry), 'package.json'), 'utf8'));
    return { harnessId: 'claudeCode', version: typeof pkg.version === 'string' ? pkg.version : null };
  } catch {
    return { harnessId: 'claudeCode', version: null };
  }
}
