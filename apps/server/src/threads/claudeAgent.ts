import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Agent, AgentMessage, AgentRun } from './agent.js';

/** How long a stopped turn gets to wind down gracefully before its process is killed. */
const HARD_STOP_AFTER_MS = 3000;

/**
 * Runs a turn through the Claude Agent SDK, the way T3 does (ADR 0006). Agents
 * get every permission without prompts (ADR 0005). Settings come from the
 * account's accio-owned config folder via CLAUDE_CONFIG_DIR (ADR 0003) and from
 * the checkout's own .claude folder and CLAUDE.md.
 */
export const claudeAgent: Agent = {
  async *run({ cwd, prompt, sessionId, env, signal }: AgentRun) {
    const abortController = new AbortController();
    const stderr: string[] = [];
    const q = query({
      prompt,
      options: {
        cwd,
        env,
        abortController,
        resume: sessionId ?? undefined,
        includePartialMessages: true,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        settingSources: ['user', 'project', 'local'],
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        stderr: (data) => {
          stderr.push(data);
          if (stderr.length > 50) stderr.shift();
        },
      },
    });

    // Stop ends the turn for accio at once. The agent is asked to interrupt
    // gracefully (so its session stays resumable) and is killed if it lingers.
    const stopped = new Promise<'stopped'>((resolve) => {
      const onAbort = () => {
        resolve('stopped');
        q.interrupt().catch(() => {});
        setTimeout(() => abortController.abort(), HARD_STOP_AFTER_MS).unref();
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
        yield step.value as AgentMessage;
      }
    } catch (err) {
      if (signal.aborted) return;
      const detail = stderr.join('').trim().split('\n').slice(-5).join('\n');
      throw new Error(detail ? `${(err as Error).message}\n${detail}` : (err as Error).message);
    }
  },
};
