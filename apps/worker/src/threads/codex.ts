import { mkdir } from 'node:fs/promises';
import { startCodex, type CodexFactory, type CodexNotification } from '@accio/codex';
import { systemPromptText } from '../harnesses/systemPrompt.js';
import { measuredHarness } from '../harnesses/promptMeasurement.js';
import type { Harness, HarnessEvent, HarnessImage } from './harness.js';
import { secretInstructions } from '../secrets/secrets.js';
import { ACCIO_MCP_SERVER } from '../tools/tools.js';
import { SUBAGENT_TIMEOUT_SEC } from './subagents.js';
import { summarizeTool } from './transcript.js';
import { CodexSkills, disabledSkillsConfig } from './codexSkills.js';
import { CodexItems, CodexItemType, CodexMessageDelta, CodexRouting, CodexThreadResult, CodexTokenUsage, CodexTurnCompleted, CodexTurnResult, parseCodex } from './codexMessages.js';

/** Codex runs on this machine. Only the profile's scoped proxy key reaches it. */
export function codexHarness(factory: CodexFactory = startCodex): Harness {
  const discovered = new CodexSkills();
  return measuredHarness('codex', {
    async skills({ cwd, env, signal }) {
      const home = env.CODEX_HOME;
      if (!home) return [];
      const known = discovered.harness(home);
      if (known) return known;
      await mkdir(home, { recursive: true });
      const client = await factory({ home, cwd, env, signal });
      try { await discovered.discover(client, home, cwd ?? home); } finally { await client.close(); }
      return discovered.harness(home) ?? [];
    },
    async generateText({ prompt, model, effort, env, signal }) {
      // A Responses request avoids starting an agent with shell or repository access.
      const response = await fetch(`${env.ACCIO_OPENAI_URL}/responses`, {
        method: 'POST', signal, redirect: 'error',
        headers: { authorization: `Bearer ${env.ACCIO_OPENAI_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, stream: true, store: false,
          instructions: 'You name conversations. Return only the requested JSON.',
          input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
          tools: [], ...(effort ? { reasoning: { effort } } : {}), text: { verbosity: 'low' },
        }),
      });
      if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('Title generation provider is unavailable'); }
      let buffer = '';
      let text = '';
      let size = 0;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.length;
          if (size > 128_000) throw new Error('Title response exceeded its limit');
          buffer += decoder.decode(chunk.value, { stream: true });
          const lines = buffer.split('\n'); buffer = lines.pop()!;
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            const event = JSON.parse(data);
            if (event.type === 'response.output_text.delta') text += event.delta;
            if (event.type === 'response.failed' || event.type === 'error' || event.type === 'response.incomplete') throw new Error('Title generation failed');
            if (event.type === 'response.completed') return text || event.response?.output?.flatMap((item: any) => item.content ?? []).map((part: any) => part.text ?? '').join('') || '';
          }
        }
        throw new Error('Title response was interrupted');
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    },
    async *run({ cwd, prompt, images, sessionId, model, effort, modelName, env, tools, signal, resourceInstructions, mcps, secretPurposes, registerSteer, toolsOff = [] }) {
      if (signal.aborted) return;
      const home = env.CODEX_HOME;
      const baseUrl = env.ACCIO_OPENAI_URL;
      if (!home || !baseUrl || !env.ACCIO_OPENAI_KEY) throw new Error('Codex profile configuration is missing');
      await mkdir(home, { recursive: true });
      const config = [
        'model_provider="accio"', 'model_providers.accio.name="accio hub"',
        `model_providers.accio.base_url=${JSON.stringify(baseUrl)}`,
        'model_providers.accio.env_key="ACCIO_OPENAI_KEY"', 'model_providers.accio.wire_api="responses"',
        'model_providers.accio.supports_websockets=false',
        'approval_policy="never"', 'sandbox_mode="danger-full-access"',
        // Built-in tools switched off; app-server reads them at launch, so they hold on resume too.
        ...toolsOff.flatMap((t) => t.config ?? []),
        ...Object.entries(mcps ?? {}).flatMap(([id, mcp]) => {
          // Override keys are dot-separated paths, not TOML key expressions.
          // IDs are validated as bare keys by the protocol.
          const prefix = `mcp_servers.${id}`;
          return mcp.type === 'http' ? [`${prefix}.url=${JSON.stringify(mcp.url)}`, ...Object.entries(mcp.headers).map(([key, value]) => `${prefix}.http_headers.${key}=${JSON.stringify(value)}`)] : [`${prefix}.command=${JSON.stringify(mcp.command)}`, `${prefix}.args=${JSON.stringify(mcp.args)}`];
        }),
      ];
      const launch = () => factory({ home, cwd, env, signal, config: [...config, ...disabledSkillsConfig(discovered.known(home))] });
      // ADR 0020: skills installed on this machine are no skill level. Codex reads them at
      // launch, so a launch that still finds one enabled is replaced by one with it disabled.
      const client = await (async () => {
        const first = await launch();
        try { if (!await discovered.discover(first, home, cwd)) return first; } catch (error) { await first.close(); throw error; }
        await first.close();
        return launch();
      })();
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
        // Config applies on resume too, so resumed threads keep accio's tools, request_secret among them.
        const config = {
          ...(tools ? { [`mcp_servers.${ACCIO_MCP_SERVER}`]: { url: tools.url, http_headers: { Authorization: tools.authorization }, tool_timeout_sec: SUBAGENT_TIMEOUT_SEC } } : {}),
        };
        const params = { cwd, ...(model ? { model } : {}), ...(Object.keys(config).length ? { config } : {}), approvalPolicy: 'never', sandbox: 'danger-full-access',
          developerInstructions: [systemPromptText({ harnessId: 'codex', model, modelName }), resourceInstructions,
            tools && secretPurposes ? secretInstructions(secretPurposes) : undefined,
          ].filter(Boolean).join('\n\n') };
        const method = sessionId ? 'thread/resume' : 'thread/start';
        const result = parseCodex(method, CodexThreadResult, await client.request(method, { ...params, ...(sessionId ? { threadId: sessionId } : {}) }));
        threadId = result.thread.id;
        yield { type: 'harness_event', event: { kind: 'session', id: threadId! } };
        if (signal.aborted) return;
        const turn = parseCodex('turn/start', CodexTurnResult, await client.request('turn/start', { threadId, input: codexInput(prompt, images), ...(model ? { model } : {}), ...(effort ? { effort } : {}) }));
        turnId = turn.turn.id;
        registerSteer?.(async (text, images) => {
          if (signal.aborted) throw new Error('This turn has stopped');
          await client.request('turn/steer', { threadId, expectedTurnId: turnId, input: codexInput(text, images) });
        });
        if (signal.aborted) { clearTimeout(stopTimer); stop(); }
        for (;;) {
          if (!events.length && !failure && !forcedStop) await new Promise<void>((resolve) => { wake = resolve; });
          if (forcedStop) return;
          if (failure) throw failure;
          for (const event of events.splice(0)) {
            const route = parseCodex(event.method, CodexRouting, event.params ?? {});
            if (route.threadId && route.threadId !== threadId) continue;
            if (route.turnId && route.turnId !== turnId) continue;
            if (event.method === 'turn/completed') {
              const completed = parseCodex(event.method, CodexTurnCompleted, event.params).turn;
              if (completed.id !== turnId) continue;
              registerSteer?.(undefined);
              if (completed.status === 'interrupted' && !signal.aborted) throw new Error('Codex interrupted the turn');
              if (!signal.aborted) yield { type: 'harness_event', event: { kind: 'end', ...(completed.status === 'failed' ? { error: completed.error?.message ?? 'Codex turn failed' } : {}) } };
              return;
            }
            for (const mapped of codexEvents(event)) yield { type: 'harness_event', event: mapped };
          }
        }
      } finally {
        registerSteer?.(undefined);
        signal.removeEventListener('abort', stop);
        clearTimeout(stopTimer); off(); offExit();
        // Closing the native child is bounded, even if interrupt never acknowledged.
        await client.close();
      }
    },
  });
}

/** Keep streamed assistant text and authoritative item completion in the same transcript item. */
export function codexEvents({ method, params }: CodexNotification): HarnessEvent[] {
  if (method === 'item/agentMessage/delta') {
    const { itemId, delta } = parseCodex(method, CodexMessageDelta, params);
    return [{ kind: 'text', id: itemId, text: delta, append: true }];
  }
  // GLOSSARY: Context window. Codex counts the latest request and its reply against the model's window.
  if (method === 'thread/tokenUsage/updated') {
    const { last, modelContextWindow } = parseCodex(method, CodexTokenUsage, params).tokenUsage ?? {};
    return typeof modelContextWindow === 'number' && modelContextWindow > 0 && typeof last?.totalTokens === 'number'
      ? [{ kind: 'context', usedTokens: last.totalTokens, windowTokens: modelContextWindow }] : [];
  }
  if (method !== 'item/started' && method !== 'item/completed') return [];
  const done = method === 'item/completed';
  const status = (item: { status?: string | null; success?: boolean | null; exitCode?: number | null }) =>
    done ? (item.status === 'failed' || item.status === 'declined' || item.success === false || (item.exitCode != null && item.exitCode !== 0) ? 'error' : 'done') : 'running';
  switch (parseCodex(method, CodexItemType, params).item.type) {
    case 'agentMessage': case 'plan': {
      const { item } = parseCodex(method, CodexItems.text, params);
      return done ? [{ kind: 'text', id: item.id, text: item.text }] : [];
    }
    case 'commandExecution': {
      const { item } = parseCodex(method, CodexItems.commandExecution, params);
      return [{ kind: 'tool', id: item.id, name: 'Shell', summary: item.command, input: { command: item.command, ...(item.cwd ? { cwd: item.cwd } : {}) }, status: status(item), output: item.aggregatedOutput ?? undefined }];
    }
    case 'fileChange': {
      const { item } = parseCodex(method, CodexItems.fileChange, params);
      return [{ kind: 'tool', id: item.id, name: 'Edit', summary: item.changes.map(c => c.path).join(', '), status: status(item),
        ...(done ? { output: item.changes.map(c => `${c.path}\n${c.diff ?? ''}`).join('\n') } : {}) }];
    }
    case 'mcpToolCall': {
      const { item } = parseCodex(method, CodexItems.mcpToolCall, params);
      const name = `${item.server}/${item.tool}`;
      return [{ kind: 'tool', id: item.id, name, summary: summarizeTool(name, item.arguments ?? {}), input: item.arguments ?? {}, status: status(item),
        ...(done ? { output: JSON.stringify(item.error ?? item.result ?? '') } : {}) }];
    }
    case 'webSearch': {
      const { item } = parseCodex(method, CodexItems.webSearch, params);
      return [{ kind: 'tool', id: item.id, name: 'Search', summary: item.query ?? '', status: status(item) }];
    }
    default: return [];
  }
}

/** GLOSSARY: Image attachment. Codex reads each image from its saved file; the text follows them. */
export function codexInput(text: string, images: readonly HarnessImage[] = []) {
  return [...images.map((image) => ({ type: 'localImage' as const, path: image.path })), { type: 'text' as const, text }];
}
