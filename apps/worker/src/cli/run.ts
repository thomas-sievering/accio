import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { methods, DEFAULT_PORT, type MethodName, type ThreadView } from '@accio/protocol';
import { CliClient } from './client.js';

const HELP = `accio terminal client — JSON results, JSON errors on stderr

pnpm cli methods [prefix]                List available RPC methods (offline)
pnpm cli schema <method>                 Show a method's JSON input schema (offline)
pnpm cli call <method> [JSON | @file | -] Call any app operation; - reads stdin
pnpm cli <method> [JSON | @file | -]      Shorthand for call
pnpm cli events [event-name]             Stream events as JSON Lines until Ctrl+C
pnpm cli wait <thread-id>                Wait until a thread leaves running state

Options (before or after command):
  --url <worker-url>  HTTP(S)/WS(S) worker address, including a UI #token link
  --home <path>      Read existing server.json (default ACCIO_HOME or ~/.accio)
  --hub <id>         Select the same hub context as an app window
  --timeout <ms>     Connection/request/wait timeout (default 30000)
  --help             Show this help

Environment: ACCIO_URL, ACCIO_TOKEN, ACCIO_HOME, ACCIO_HOST, ACCIO_PORT, ACCIO_HUB.
Explicit URLs require their own token (URL or ACCIO_TOKEN); local config is read
only for the default connection. No worker or config is created by this client.
Exit: 0 success, 1 error (including failed/interrupted thread), 2 timeout.
`;

export async function connection(options: { url?: string; home?: string; hub?: string }, env: NodeJS.ProcessEnv): Promise<URL> {
  const explicit = options.url ?? env.ACCIO_URL;
  let stored: { host?: string; port?: number; token?: string } = {};
  if (!explicit) {
    try { stored = JSON.parse(await readFile(join(options.home ?? env.ACCIO_HOME ?? join(homedir(), '.accio'), 'server.json'), 'utf8')); }
    catch { throw new Error('Cannot read worker server.json. Start a worker first, or provide --url and ACCIO_TOKEN.'); }
  }
  let url: URL;
  try { url = new URL(explicit ?? `http://${env.ACCIO_HOST ?? stored.host ?? '127.0.0.1'}:${env.ACCIO_PORT ?? stored.port ?? DEFAULT_PORT}`); }
  catch { throw new Error('Invalid worker URL'); }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP(S) or WS(S) worker URL without user info.');
  const token = env.ACCIO_TOKEN ?? new URLSearchParams(url.hash.slice(1)).get('token') ?? url.searchParams.get('token') ?? stored.token;
  if (!token) throw new Error('Missing worker token. Set ACCIO_TOKEN or use the worker URL containing #token=.');
  url.protocol = ['https:', 'wss:'].includes(url.protocol) ? 'wss:' : 'ws:';
  url.pathname = '/ws';
  url.hash = '';
  const hub = options.hub ?? env.ACCIO_HUB ?? url.searchParams.get('hub');
  url.search = '';
  url.searchParams.set('token', token);
  if (hub) url.searchParams.set('hub', hub);
  return url;
}

export type CliIO = { out: (value: string) => void; err: (value: string) => void; stdin: () => Promise<string> };
const defaultIO: CliIO = {
  out: (text) => process.stdout.write(text + '\n'),
  err: (text) => process.stderr.write(text + '\n'),
  stdin: async () => { let text = ''; for await (const chunk of process.stdin) text += chunk; return text; },
};

export async function runCli(args: string[], io = defaultIO, env = process.env): Promise<number> {
  let client: CliClient | undefined;
  try {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
      url: { type: 'string' }, home: { type: 'string' }, hub: { type: 'string' }, timeout: { type: 'string' }, help: { type: 'boolean' },
    } });
    if (values.help || !positionals.length) { io.out(HELP); return 0; }
    const [command, ...rest] = positionals;
    const emit = (value: unknown) => io.out(JSON.stringify(value));
    const timeout = Number(values.timeout ?? 30_000);
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2_147_483_647) throw new Error('--timeout must be a positive integer at most 2147483647');
    if (command === 'methods') {
      if (rest.length > 1) throw new Error('Usage: methods [prefix]');
      emit(Object.keys(methods).filter((name) => name.startsWith(rest[0] ?? '')).sort()); return 0;
    }
    const name = command === 'call' || command === 'schema' ? rest[0] : command;
    const definition = Object.hasOwn(methods, name ?? '') ? methods[name as MethodName] : undefined;
    if (command === 'schema') {
      if (!definition || rest.length !== 1) throw new Error('Usage: schema <known-method> (see methods)');
      emit(definition.params.toJSONSchema()); return 0;
    }
    const streaming = command === 'events' || command === 'wait';
    let params: unknown;
    if (streaming) {
      if (rest.length > 1 || command === 'wait' && !rest[0]) throw new Error(`Usage: ${command} ${command === 'wait' ? '<thread-id>' : '[event-name]'}`);
    } else {
      if (!definition) throw new Error(`Unknown method ${name}. Use methods to discover operations.`);
      const inputs = command === 'call' ? rest.slice(1) : rest;
      if (inputs.length > 1) throw new Error('Pass params as one JSON argument, @file, or - for stdin.');
      const input = inputs[0] ?? '{}';
      const text = input === '-' ? await io.stdin() : input.startsWith('@') ? await readFile(input.slice(1), 'utf8') : input;
      let raw: unknown;
      try { raw = JSON.parse(text); }
      catch { throw new Error('Params must be valid JSON'); }
      // Never include invalid values in errors: params may contain secrets.
      const parsed = definition.params.safeParse(raw);
      if (!parsed.success) throw new Error(`Invalid params for ${name}. Use schema ${name} to inspect required input.`);
      params = parsed.data;
    }
    client = await CliClient.open(await connection(values, env), timeout);
    if (!streaming) { emit(await client.call(name!, params)); return 0; }
    const active = client;
    return await new Promise<number>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      let timerPoll: NodeJS.Timeout | undefined;
      let done = false;
      const cleanup = () => { done = true; clearTimeout(timer); clearTimeout(timerPoll); process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); };
      const finish = (code: number) => { cleanup(); resolve(code); };
      const fail = (error: Error) => { cleanup(); reject(error); };
      const interrupt = () => finish(130);
      process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
      active.onClose = fail;
      if (command === 'events') {
        active.onEvent = (event) => { if (!rest[0] || event.event === rest[0]) emit(event); };
        return;
      }
      timer = setTimeout(() => fail(new Error('Timed out waiting for thread')), timeout);
      // Sequential fresh snapshots avoid missing completion between subscription and read.
      const poll = async () => {
        try {
          const threads = await active.call('threads.list', {}) as ThreadView[];
          if (done) return;
          const thread = threads.find((thread) => thread.id === rest[0]);
          if (!thread) throw new Error('Thread not found in selected hub');
          if (thread.status !== 'running') { emit(thread); finish(thread.status === 'idle' ? 0 : 1); return; }
          timerPoll = setTimeout(() => void poll(), 200);
        } catch (error) { fail(error instanceof Error ? error : new Error('Could not read thread')); }
      };
      void poll();
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CLI failed';
    io.err(JSON.stringify({ error: message }));
    return message.startsWith('Timed out') ? 2 : 1;
  } finally { client?.close(); }
}
