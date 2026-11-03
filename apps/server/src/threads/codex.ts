import { mkdir } from 'node:fs/promises';
import { startCodex, type CodexFactory, type CodexNotification } from '@accio/codex';
import { systemPromptText } from '../harnesses/systemPrompt.js';
import type { Harness, HarnessEvent } from './harness.js';
import { ACCIO_MCP_SERVER } from '../tools/tools.js';

/** Codex runs on this machine. Only the profile's scoped proxy key reaches it. */
export function codexHarness(factory: CodexFactory = startCodex): Harness {
  return {
    async *run({ cwd, prompt, sessionId, model, modelName, env, tools, signal, resourceInstructions, mcps }) {
      if (signal.aborted) return;
      const home = env.CODEX_HOME;
      const baseUrl = env.ACCIO_OPENAI_URL;
      if (!home || !baseUrl || !env.ACCIO_OPENAI_KEY) throw new Error('Codex profile configuration is missing');
      await mkdir(home, { recursive: true });
      const client = await factory({ home, cwd, env, signal, config: [
        'model_provider="accio"', 'model_providers.accio.name="accio hub"',
        `model_providers.accio.base_url=${JSON.stringify(baseUrl)}`,
        'model_providers.accio.env_key="ACCIO_OPENAI_KEY"', 'model_providers.accio.wire_api="responses"',
        'model_providers.accio.supports_websockets=false',
        'approval_policy="never"', 'sandbox_mode="danger-full-access"',
        ...Object.entries(mcps ?? {}).flatMap(([id, mcp]) => {
          // Override keys are dot-separated paths, not TOML key expressions.
          // IDs are validated as bare keys by the protocol.
          const prefix = `mcp_servers.${id}`;
          return mcp.type === 'http' ? [`${prefix}.url=${JSON.stringify(mcp.url)}`, ...Object.entries(mcp.headers).map(([key, value]) => `${prefix}.http_headers.${key}=${JSON.stringify(value)}`)] : [`${prefix}.command=${JSON.stringify(mcp.command)}`, `${prefix}.args=${JSON.stringify(mcp.args)}`];
        }),
      ] });
      const events: CodexNotification[] = [];
      let wake = () => {};
      let failure: Error | undefined;
      let threadId: string | undefined;
      let turnId: string | undefined;
      let stopTimer: ReturnType<typeof setTimeout> | undefined;
      let forcedStop = false;
      const off = client.onNotification((event) => { events.push(event); wake(); });
      const offExit = client.onExit((error) => { failure = error; wake(); });
      const stop = () => {
        if (threadId && turnId) void client.request('turn/interrupt', { threadId, turnId }).catch(() => {});
        stopTimer = setTimeout(() => { forcedStop = true; wake(); void client.close(); }, 3000);
        wake();
      };
      signal.addEventListener('abort', stop, { once: true });
      try {
        if (signal.aborted) return;
        // Config, unlike dynamic tools, applies on resume too, so resumed threads keep accio's tools.
        const config = tools ? { [`mcp_servers.${ACCIO_MCP_SERVER}`]: { url: tools.url, http_headers: { Authorization: tools.authorization } } } : undefined;
        const params = { cwd, ...(model ? { model } : {}), ...(config ? { config } : {}), approvalPolicy: 'never', sandbox: 'danger-full-access', developerInstructions: [systemPromptText({ harnessId: 'codex', model, modelName }), resourceInstructions].filter(Boolean).join('\n\n') };
        const result = await client.request(sessionId ? 'thread/resume' : 'thread/start', { ...params, ...(sessionId ? { threadId: sessionId } : {}) });
        threadId = result.thread.id;
        yield { type: 'harness_event', event: { kind: 'session', id: threadId! } };
        if (signal.aborted) return;
        const turn = await client.request('turn/start', { threadId, input: [{ type: 'text', text: prompt }], ...(model ? { model } : {}) });
        turnId = turn.turn.id;
        if (signal.aborted) { clearTimeout(stopTimer); stop(); }
        for (;;) {
          if (!events.length && !failure && !forcedStop) await new Promise<void>((resolve) => { wake = resolve; });
          if (forcedStop) return;
          if (failure) throw failure;
          for (const event of events.splice(0)) {
            if (event.params.threadId && event.params.threadId !== threadId) continue;
            if (event.params.turnId && event.params.turnId !== turnId) continue;
            if (event.method === 'turn/completed') {
              const completed = event.params.turn;
              if (completed.id !== turnId) continue;
              if (completed.status === 'interrupted' && !signal.aborted) throw new Error('Codex interrupted the turn');
              if (!signal.aborted) yield { type: 'harness_event', event: { kind: 'end', ...(completed.status === 'failed' ? { error: completed.error?.message ?? 'Codex turn failed' } : {}) } };
              return;
            }
            for (const mapped of codexEvents(event)) yield { type: 'harness_event', event: mapped };
          }
        }
      } finally {
        signal.removeEventListener('abort', stop);
        clearTimeout(stopTimer); off(); offExit();
        // Closing the native child is bounded, even if interrupt never acknowledged.
        await client.close();
      }
    },
  };
}

/** Keep streamed assistant text and authoritative item completion in the same transcript item. */
export function codexEvents({ method, params }: CodexNotification): HarnessEvent[] {
  if (method === 'item/agentMessage/delta') return [{ kind: 'text', id: params.itemId, text: params.delta, append: true }];
  if (method !== 'item/started' && method !== 'item/completed') return [];
  const item = params.item;
  const done = method === 'item/completed';
  if (item.type === 'agentMessage' || item.type === 'plan') return done ? [{ kind: 'text', id: item.id, text: item.text }] : [];
  const status = done ? (item.status === 'failed' || item.status === 'declined' || item.success === false || (item.exitCode != null && item.exitCode !== 0) ? 'error' : 'done') : 'running';
  switch (item.type) {
    case 'commandExecution': return [{ kind: 'tool', id: item.id, name: 'Shell', summary: item.command, input: { command: item.command, ...(item.cwd ? { cwd: item.cwd } : {}) }, status, output: item.aggregatedOutput ?? undefined }];
    case 'fileChange': return [{ kind: 'tool', id: item.id, name: 'Edit', summary: item.changes.map((c: any) => c.path).join(', '), status,
      ...(done ? { output: item.changes.map((c: any) => `${c.path}\n${c.diff ?? ''}`).join('\n') } : {}) }];
    case 'mcpToolCall': return [{ kind: 'tool', id: item.id, name: `${item.server}/${item.tool}`, summary: JSON.stringify(item.arguments ?? {}), input: item.arguments ?? {}, status,
      ...(done ? { output: JSON.stringify(item.error ?? item.result ?? '') } : {}) }];
    case 'webSearch': return [{ kind: 'tool', id: item.id, name: 'Search', summary: item.query ?? '', status }];
    default: return [];
  }
}
