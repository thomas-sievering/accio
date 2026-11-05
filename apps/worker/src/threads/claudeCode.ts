import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { systemPromptText } from '../harnesses/systemPrompt.js';
import { ACCIO_MCP_SERVER } from '../tools/tools.js';
import { SUBAGENT_TIMEOUT_SEC } from './subagents.js';
import type { Harness, HarnessImage, HarnessMessage, HarnessTurn } from './harness.js';
import { secretMcpServer } from '../secrets/claudeTool.js';
import { savedPurposeInstructions, SECRET_MCP_SERVER } from '../secrets/secrets.js';

/** How long a stopped turn gets to wind down gracefully before its process is killed. */
const HARD_STOP_AFTER_MS = 3000;

/**
 * Runs a turn through the Claude Agent SDK, the way T3 does (ADR 0006). Harnesses
 * get every permission without prompts (ADR 0005). Settings come from the
 * profile's accio-owned config folder via CLAUDE_CONFIG_DIR (ADR 0003) and from
 * the checkout's own .claude folder and CLAUDE.md.
 */
export const claudeCode: Harness = {
  async generateText({ cwd, prompt, model, effort, env, signal }) {
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const q = query({ prompt, options: {
      cwd, model, env: { ...env, CLAUDE_CODE_PROMPT_CACHE_TTL: '5m', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '256' }, abortController,
      tools: [], mcpServers: {}, strictMcpConfig: true, settingSources: [],
      systemPrompt: 'You name conversations. Return only the requested JSON.',
      maxTurns: 1, persistSession: false,
      ...(effort ? { effort: effort as 'low' } : {}),
    } });
    try {
      for await (const message of q) {
        if (message.type === 'result') {
          if (message.is_error || !('result' in message)) throw new Error('Title generation failed');
          return message.result;
        }
      }
      throw new Error('No generated title');
    } finally { signal.removeEventListener('abort', abort); q.close(); await q.return(); }
  },
  async *run({ cwd, prompt, images, sessionId, model, effort, modelName, env, tools, signal, resourceInstructions, mcps, requestSecret, secretPurposes, registerSteer, toolsOff = [] }: HarnessTurn) {
    if (signal.aborted) return;
    const abortController = new AbortController();
    const stderr: string[] = [];
    const input = new SteeringInput(images?.length ? await userContent(prompt, images) : prompt, sessionId ?? '');
    const q = query({
      prompt: input.stream(),
      options: {
        cwd,
        model,
        ...(effort ? { effort: effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max' } : {}),
        // Claude's own limits on one MCP call, in total and without progress; accio's agent tool can run
        // as long as a sub-agent needs, including one long silent step such as a build.
        env: tools ? { ...env, MCP_TOOL_TIMEOUT: String(SUBAGENT_TIMEOUT_SEC * 1000), CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT: String(SUBAGENT_TIMEOUT_SEC * 1000) } : env,
        abortController,
        resume: sessionId ?? undefined,
        includePartialMessages: true,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        settingSources: ['user', 'project', 'local'],
        // Removed from the model's context, not only refused (docs/plans/harness-tools.md).
        ...(toolsOff.length ? { disallowedTools: toolsOff.flatMap((t) => t.tools) } : {}),
        mcpServers: mcps || tools || requestSecret ? { ...mcps,
          ...(tools ? { [ACCIO_MCP_SERVER]: { type: 'http' as const, url: tools.url, headers: { Authorization: tools.authorization } } } : {}),
          ...(requestSecret ? { [SECRET_MCP_SERVER]: secretMcpServer(requestSecret) } : {}),
        } : undefined,
        systemPrompt: { type: 'preset', preset: 'claude_code', append: [systemPromptText({ harnessId: 'claudeCode', model, modelName }), resourceInstructions,
          requestSecret ? `When a task needs a token, call mcp__${SECRET_MCP_SERVER}__request_secret with a stable service/operation/target slot. Accio reuses permitted saved credentials automatically. Never ask for secrets in conversation or print, copy, or link secret files.` + savedPurposeInstructions(secretPurposes) : undefined,
        ].filter(Boolean).join('\n\n') },
        stderr: (data) => {
          stderr.push(data);
          if (stderr.length > 50) stderr.shift();
        },
      },
    });
    registerSteer?.(async (text, images) => input.send(await userContent(text, images)));

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
        if (step.value.type === 'result') {
          registerSteer?.(undefined);
          yield step.value as HarnessMessage;
          return;
        }
        yield step.value as HarnessMessage;
      }
    } catch (err) {
      if (signal.aborted) return;
      const detail = stderr.join('').trim().split('\n').slice(-5).join('\n');
      throw new Error(detail ? `${(err as Error).message}\n${detail}` : (err as Error).message);
    } finally {
      registerSteer?.(undefined);
      input.close();
      signal.removeEventListener('abort', onAbort);
      await interruption;
      clearTimeout(stopTimer);
      q.close();
      await q.return();
    }
  },
};

type UserContent = SDKUserMessage['message']['content'];

/**
 * GLOSSARY: Image attachment. Images go before the text, as T3 Code sends them:
 * Claude Code expands a skill command only from the message's last block.
 */
export async function userContent(text: string, images: readonly HarnessImage[] = []): Promise<UserContent> {
  if (!images.length) return text;
  const blocks = await Promise.all(images.map(async (image) => ({ type: 'image' as const,
    source: { type: 'base64' as const, media_type: image.mimeType as 'image/png', data: (await readFile(image.path)).toString('base64') } })));
  return [...blocks, { type: 'text' as const, text }];
}

/** Keep stdin open for native mid-turn input; close it with this turn. */
class SteeringInput {
  private pending: { content: UserContent; resolve: () => void; reject: (error: Error) => void }[] = [];
  private wake = () => {};
  private closed = false;
  constructor(private prompt: UserContent, private sessionId: string) {}
  send(content: UserContent) {
    if (this.closed) return Promise.reject(new Error('This turn has finished'));
    return new Promise<void>((resolve, reject) => { this.pending.push({ content, resolve, reject }); this.wake(); });
  }
  private message(content: UserContent, steer = false): SDKUserMessage {
    return { type: 'user', session_id: this.sessionId, parent_tool_use_id: null,
      message: { role: 'user', content }, ...(steer ? { priority: 'now' as const } : {}) };
  }
  async *stream(): AsyncIterable<SDKUserMessage> {
    yield this.message(this.prompt);
    while (!this.closed) {
      const next = this.pending.shift();
      if (!next) { await new Promise<void>(resolve => { this.wake = resolve; }); continue; }
      next.resolve();
      yield this.message(next.content, true);
    }
  }
  close() {
    this.closed = true;
    for (const next of this.pending.splice(0)) next.reject(new Error('This turn has finished'));
    this.wake();
  }
}

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
