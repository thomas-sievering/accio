import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { systemPromptText } from '../harnesses/systemPrompt.js';
import { measuredHarness } from '../harnesses/promptMeasurement.js';
import { BUILTIN_TOOLS, type BuiltinTool } from '../harnesses/builtinTools.js';
import { secretInstructions } from '../secrets/secrets.js';
import { ACCIO_MCP_SERVER } from '../tools/tools.js';
import { SUBAGENT_TIMEOUT_SEC } from './subagents.js';
import { summarizeTool } from './transcript.js';
import { claudeCode } from './claudeCode.js';
import type { Harness, HarnessEvent, HarnessImage, HarnessMcp, HarnessMessage, HarnessTurn } from './harness.js';

/** The provider pi-claude-bridge registers; Accio's Pi models are its model ids (ADR 0026). */
const PI_PROVIDER = 'claude-bridge';
/** How long a stopped turn gets to settle before Pi is killed. */
const HARD_STOP_AFTER_MS = 3000;

/** One RPC record from Pi: a response to a command, or a session event. */
type PiRecord = { type: string; [key: string]: unknown };
/** A running `pi --mode rpc`. Tests replace it. */
export type PiProcess = {
  /** Sends a command and resolves with its response's data; rejects when Pi reports a failure. */
  request(command: PiRecord): Promise<unknown>;
  onEvent(listener: (event: PiRecord) => void): () => void;
  /** Called once when Pi exits; with an error unless it was closed. */
  onExit(listener: (error?: Error) => void): () => void;
  close(): Promise<void>;
};
export type PiFactory = (input: { args: string[]; cwd: string; env: Record<string, string> }) => Promise<PiProcess>;

const resolvePackage = (name: string) => fileURLToPath(import.meta.resolve(name));
/** The CLI of the Pi accio bundles, and the bridge it loads. */
const piCli = () => join(dirname(resolvePackage('@earendil-works/pi-coding-agent')), 'bundle', 'cli.js');
const bridgeDir = () => dirname(resolvePackage('pi-claude-bridge/package.json'));

/**
 * Under Electron the worker is Node only through ELECTRON_RUN_AS_NODE. Pi needs it to start, but
 * must not pass it on: commands Pi runs, such as an Electron app's dev server, would start as Node.
 */
const LAUNCH = 'delete process.env.ELECTRON_RUN_AS_NODE; const { pathToFileURL } = await import("node:url"); await import(pathToFileURL(process.argv[1]).href);';

/** Starts the bundled Pi in RPC mode with exactly the turn's environment; nothing of the worker's own. */
const startPi: PiFactory = async ({ args, cwd, env }) => {
  const electron = !!process.versions.electron;
  const child = spawn(process.execPath, [...(electron ? ['--input-type=module', '-e', LAUNCH] : []), piCli(), ...args], {
    cwd, env: electron ? { ...env, ELECTRON_RUN_AS_NODE: '1' } : env, windowsHide: true, stdio: 'pipe',
  });
  const listeners = new Set<(event: PiRecord) => void>();
  const exits = new Set<(error?: Error) => void>();
  const pending = new Map<string, { resolve: (data: unknown) => void; reject: (error: Error) => void }>();
  const stderr: string[] = [];
  let closing = false;
  let exited: Error | undefined | null = null;
  let buffer = '';
  let next = 0;
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => { stderr.push(chunk); if (stderr.length > 50) stderr.shift(); });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
      const line = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + 1);
      if (!line) continue;
      let record: PiRecord;
      try { record = JSON.parse(line); } catch { continue; }
      if (record.type === 'response' && typeof record.id === 'string' && pending.has(record.id)) {
        const waiter = pending.get(record.id)!;
        pending.delete(record.id);
        if (record.success === false) waiter.reject(new Error(typeof record.error === 'string' ? record.error : `Pi refused ${String(record.command)}`));
        else waiter.resolve(record.data);
        continue;
      }
      for (const listener of listeners) listener(record);
    }
  });
  const done = new Promise<void>((resolve) => child.once('close', (code, sig) => {
    const detail = stderr.join('').trim().split('\n').slice(-5).join('\n');
    exited = closing ? undefined : new Error(`Pi stopped unexpectedly (${sig ?? `exit ${code}`})${detail ? `\n${detail}` : ''}`);
    for (const waiter of pending.values()) waiter.reject(exited ?? new Error('Pi has stopped'));
    pending.clear();
    for (const listener of exits) listener(exited);
    resolve();
  }));
  child.once('error', (error) => { if (exited === null) { exited = error; for (const listener of exits) listener(error); } });
  child.stdin.on('error', () => {});
  return {
    request(command) {
      if (exited !== null) return Promise.reject(exited ?? new Error('Pi has stopped'));
      const id = String(++next);
      return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ ...command, id }) + '\n'); });
    },
    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    onExit(listener) { exits.add(listener); return () => exits.delete(listener); },
    async close() {
      if (exited !== null) return;
      closing = true;
      // Pi leaves RPC mode at the end of its input; signals follow only if it doesn't.
      child.stdin.end();
      const term = setTimeout(() => child.kill('SIGTERM'), 1000);
      const kill = setTimeout(() => child.kill('SIGKILL'), 1000 + HARD_STOP_AFTER_MS);
      await done;
      clearTimeout(term); clearTimeout(kill);
    },
  };
};

/**
 * The tool names Pi declares for a turn: its own that are switched on, or on by default when the
 * turn names none off. MCP tools stay, as Pi keeps them unless a name starts with mcp__.
 */
export function piTools(toolsOff?: HarnessTurn['toolsOff']): string[] {
  const on = (tool: BuiltinTool) => toolsOff ? !toolsOff.some((off) => off.id === tool.id) : tool.default !== 'off';
  return (BUILTIN_TOOLS.pi ?? []).filter(on).flatMap((tool) => tool.tools);
}

/** Pi's MCP config for one turn: accio's tools and the turn's servers, each declared to the model directly. */
export function piMcpConfig(mcps: Record<string, HarnessMcp> = {}, tools?: HarnessTurn['tools']) {
  const servers: Record<string, unknown> = {};
  for (const [id, mcp] of Object.entries(mcps)) {
    servers[id] = mcp.type === 'http' ? { url: mcp.url, headers: mcp.headers, exposure: 'direct' } : { command: mcp.command, args: mcp.args, exposure: 'direct' };
  }
  // Pi's limit on one call; accio's agent tool can run as long as a sub-agent needs.
  if (tools) servers[ACCIO_MCP_SERVER] = { url: tools.url, headers: { Authorization: tools.authorization }, exposure: 'direct', timeout: SUBAGENT_TIMEOUT_SEC };
  return { mcpServers: servers, autoEnableCodemode: false };
}

/** Pi's tools under the names accio's transcript gives Claude Code's, with the path where its summaries look. */
const TOOL_NAMES: Record<string, string> = { bash: 'Bash', read: 'Read', edit: 'Edit', write: 'Write', grep: 'Grep', find: 'Glob', ls: 'LS' };
function piTool(name: string, args: unknown) {
  const input = args && typeof args === 'object' ? { ...(args as Record<string, unknown>) } : {};
  if (typeof input.path === 'string' && ['read', 'edit', 'write'].includes(name)) { input.file_path = input.path; delete input.path; }
  const shown = TOOL_NAMES[name] ?? name;
  return { name: shown, input, summary: summarizeTool(shown, input) };
}

function resultText(result: unknown): string {
  const content = result && typeof result === 'object' ? (result as { content?: unknown }).content : undefined;
  if (!Array.isArray(content)) return typeof result === 'string' ? result : '';
  return content.map((part) => part?.type === 'text' && typeof part.text === 'string' ? part.text : part?.type === 'image' ? '[image]' : '').join('');
}

type PiUsage = { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number };
type PiMessage = { role?: string; content?: unknown; stopReason?: string; errorMessage?: string; usage?: PiUsage };

/**
 * Turns Pi's session events into accio's. Assistant messages carry no id of their own, so each
 * gets one when it starts; streamed text is replaced by the authoritative message at its end.
 */
class PiEvents {
  private message: string | undefined;
  private tools = new Map<string, { name: string; input: Record<string, unknown>; summary: string }>();
  /** The last assistant message, whose stop reason says how the turn ended. */
  last: PiMessage | undefined;
  constructor(private windowTokens: () => number | undefined, private newId: () => string = randomUUID) {}

  map(event: PiRecord): HarnessEvent[] {
    switch (event.type) {
      case 'message_start': {
        const message = event.message as PiMessage | undefined;
        if (message?.role === 'assistant') this.message = this.newId();
        return [];
      }
      case 'message_update': {
        const update = event.assistantMessageEvent as { type?: string; contentIndex?: number; delta?: string } | undefined;
        if (!this.message || update?.type !== 'text_delta' || !update.delta) return [];
        return [{ kind: 'text', id: `${this.message}:${update.contentIndex ?? 0}`, text: update.delta, append: true }];
      }
      case 'message_end': {
        const message = event.message as PiMessage | undefined;
        if (message?.role !== 'assistant' || !this.message) return [];
        this.last = message;
        const id = this.message;
        this.message = undefined;
        const parts = Array.isArray(message.content) ? message.content : [];
        const out: HarnessEvent[] = parts.flatMap((part, index): HarnessEvent[] =>
          part?.type === 'text' && typeof part.text === 'string' && part.text ? [{ kind: 'text', id: `${id}:${index}`, text: part.text }] : []);
        // GLOSSARY: Context window. The request this reply answered: everything sent, read from cache or not, and the reply.
        const usage = message.usage;
        const window = this.windowTokens();
        const used = usage ? (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0) + (usage.output ?? 0) : 0;
        if (window && used > 0) out.push({ kind: 'context', usedTokens: used, windowTokens: window });
        return out;
      }
      case 'tool_execution_start': {
        const id = String(event.toolCallId);
        const tool = piTool(String(event.toolName), event.args);
        this.tools.set(id, tool);
        return [{ kind: 'tool', id, ...tool, status: 'running' }];
      }
      case 'tool_execution_end': {
        const id = String(event.toolCallId);
        const tool = this.tools.get(id) ?? piTool(String(event.toolName), event.args);
        this.tools.delete(id);
        return [{ kind: 'tool', id, ...tool, status: event.isError ? 'error' : 'done', output: resultText(event.result) }];
      }
      default: return [];
    }
  }
}

/** GLOSSARY: Image attachment. Pi takes each image as base64 with its type. */
async function piImages(images: readonly HarnessImage[] = []) {
  return Promise.all(images.map(async (image) => ({ type: 'image', data: (await readFile(image.path)).toString('base64'), mimeType: image.mimeType })));
}

/** Pi's thinking level for accio's effort: the same names. */
const effortLevel = (effort?: string) => effort && ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(effort) ? effort : undefined;

/**
 * Runs a turn in Pi with Claude through pi-claude-bridge (ADR 0026). Pi is the bundled one, with no
 * extensions but the bridge and its own MCP support, so nothing of the user's ~/.pi reaches it. Each
 * turn gets an agent folder of its own, for its MCP config; the bridge's state links to the profile's.
 */
export function piHarness(factory: PiFactory = startPi): Harness {
  return measuredHarness('pi', {
    // Pi ships no skills of its own; accio lists the turn's.
    async skills() { return []; },
    // Naming needs no agent: Claude Code answers directly, under the same Claude account.
    generateText: (input) => claudeCode.generateText!(input),
    async *run({ cwd, prompt, images, sessionId, model, effort, modelName, env, tools, signal, resourceInstructions, mcps, secretPurposes, registerSteer, toolsOff }) {
      if (signal.aborted) return;
      const home = env.ACCIO_PI_HOME;
      if (!home || !env.CLAUDE_CONFIG_DIR || !env.ANTHROPIC_BASE_URL || !env.ANTHROPIC_AUTH_TOKEN) throw new Error('Pi profile configuration is missing');
      const sessions = join(home, 'sessions');
      const bridgeState = join(home, 'claude-bridge');
      await Promise.all([mkdir(sessions, { recursive: true }), mkdir(bridgeState, { recursive: true }), mkdir(env.CLAUDE_CONFIG_DIR, { recursive: true }), mkdir(join(home, 'turns'), { recursive: true })]);
      // Claude Code's user settings must stay empty (see harnessEnv's piClaudeConfigOf).
      await writeFile(join(env.CLAUDE_CONFIG_DIR, 'settings.json'), '{}\n', { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
      const agentDir = await mkdtemp(join(home, 'turns', 'turn-'));
      const { ACCIO_PI_HOME: _home, ...piEnv } = env;
      let client: PiProcess | undefined;
      try {
        await symlink(bridgeState, join(agentDir, 'claude-bridge'), 'junction');
        await writeFile(join(agentDir, 'mcp.json'), JSON.stringify(piMcpConfig(mcps, tools)), { mode: 0o600 });
        const instructions = [systemPromptText({ harnessId: 'pi', model, modelName }), resourceInstructions,
          tools && secretPurposes ? secretInstructions(secretPurposes) : undefined].filter(Boolean).join('\n\n');
        const level = effortLevel(effort);
        client = await factory({ cwd, env: { ...piEnv, PI_CODING_AGENT_DIR: agentDir }, args: [
          '--mode', 'rpc', '--no-extensions', '-e', bridgeDir(), '-e', 'builtin:mcp', '--no-skills', '--no-prompt-templates', '--no-themes',
          '--session-dir', sessions, ...(sessionId ? ['--session', sessionId] : []),
          ...(model ? ['--model', `${PI_PROVIDER}/${model}`] : []), ...(level ? ['--thinking', level] : []),
          '--tools', piTools(toolsOff).join(','), '--append-system-prompt', instructions,
        ] });
        const pi = client;
        const queue: PiRecord[] = [];
        let wake = () => {};
        let failure: Error | undefined;
        let settled: { aborted: boolean } | undefined;
        const offEvent = pi.onEvent((event) => { queue.push(event); wake(); });
        const offExit = pi.onExit((error) => { failure = error ?? new Error('Pi has stopped'); wake(); });
        let stopTimer: ReturnType<typeof setTimeout> | undefined;
        let forced = false;
        const stop = () => {
          void pi.request({ type: 'abort' }).catch(() => {});
          stopTimer = setTimeout(() => { forced = true; wake(); }, HARD_STOP_AFTER_MS);
        };
        signal.addEventListener('abort', stop, { once: true });
        try {
          const state = await pi.request({ type: 'get_state' }) as { sessionId?: string; model?: { contextWindow?: number } } | undefined;
          if (!state?.sessionId) throw new Error('Pi did not report its session');
          yield { type: 'harness_event', event: { kind: 'session', id: state.sessionId } } satisfies HarnessMessage;
          if (signal.aborted) return;
          const events = new PiEvents(() => state.model?.contextWindow);
          const disposition = await pi.request({ type: 'prompt', message: prompt, ...(images?.length ? { images: await piImages(images) } : {}) }) as { disposition?: string } | undefined;
          if (disposition?.disposition === 'handled') { yield { type: 'harness_event', event: { kind: 'end' } }; return; }
          registerSteer?.(async (text, steerImages) => {
            if (signal.aborted || settled) throw new Error('This turn has stopped');
            await pi.request({ type: 'steer', message: text, ...(steerImages?.length ? { images: await piImages(steerImages) } : {}) });
          });
          for (;;) {
            if (!queue.length && !failure && !forced && !settled) await new Promise<void>((resolve) => { wake = resolve; });
            if (forced) return;
            for (const event of queue.splice(0)) {
              if (event.type === 'agent_settled') settled = { aborted: event.aborted === true };
              for (const mapped of events.map(event)) yield { type: 'harness_event', event: mapped };
            }
            if (settled) {
              registerSteer?.(undefined);
              if (signal.aborted || settled.aborted) return;
              const last = events.last;
              const error = last?.stopReason === 'error' ? last.errorMessage || 'Pi turn failed' : undefined;
              yield { type: 'harness_event', event: { kind: 'end', ...(error ? { error } : {}) } };
              return;
            }
            if (failure) { if (signal.aborted) return; throw failure; }
          }
        } finally {
          registerSteer?.(undefined);
          signal.removeEventListener('abort', stop);
          clearTimeout(stopTimer);
          offEvent(); offExit();
        }
      } finally {
        await client?.close();
        await rm(agentDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
      }
    },
  });
}

/** What this machine reports about Pi: the version accio bundles. */
export async function piInstall(): Promise<{ harnessId: 'pi'; version: string | null }> {
  try {
    const pkg = JSON.parse(await readFile(join(dirname(dirname(piCli())), '..', 'package.json'), 'utf8'));
    return { harnessId: 'pi', version: typeof pkg.version === 'string' ? pkg.version : null };
  } catch {
    return { harnessId: 'pi', version: null };
  }
}
