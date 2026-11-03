import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { access, readFile } from 'node:fs/promises';

export type CodexNotification = { method: string; params: Record<string, any> };
export interface CodexClient {
  request<T = any>(method: string, params?: unknown): Promise<T>;
  onNotification(listener: (event: CodexNotification) => void): () => void;
  onExit(listener: (error: Error) => void): () => void;
  onRequest?(handler: (method: string, params: Record<string, any>) => Promise<unknown>): () => void;
  close(): Promise<void>;
}
export type CodexFactory = (options: { home: string; cwd?: string; env?: NodeJS.ProcessEnv; config?: string[]; signal?: AbortSignal; experimental?: boolean }) => Promise<CodexClient>;

/** Remove inherited provider credentials and configuration before choosing an accio home. */
export function codexEnv(base: NodeJS.ProcessEnv, home: string): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(base).filter(([key]) => !/^(ACCIO_SECRET_|CODEX_|OPENAI_|CHATGPT_|ANTHROPIC_|CLAUDE_|CLAUDECODE$|AWS_|AZURE_|GOOGLE_|ELECTRON_RUN_AS_NODE$)/i.test(key)));
  return { ...env, CODEX_HOME: home };
}

const require = createRequire(import.meta.url);
const launcher = () => require.resolve('@openai/codex/bin/codex.js');
function executable() {
  const platform = process.platform;
  const arch = process.arch;
  const target = platform === 'win32' ? `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc`
    : platform === 'darwin' ? `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`
    : `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-unknown-linux-musl`;
  if (!['win32', 'darwin', 'linux'].includes(platform) || !['x64', 'arm64'].includes(arch)) throw new Error('Codex does not support this platform');
  const codexRequire = createRequire(launcher());
  const pkg = codexRequire.resolve(`@openai/codex-${platform}-${arch}/package.json`);
  return join(dirname(pkg), 'vendor', target, 'bin', platform === 'win32' ? 'codex.exe' : 'codex');
}

/** Bundled CLI, launched without a shell (including on Windows). Never uses the user's Codex home. */
export const startCodex: CodexFactory = async ({ home, cwd, env = process.env, config = [], signal, experimental = false }) => {
  if (signal?.aborted) throw new Error('Codex was interrupted before starting');
  const args = ['app-server', ...['cli_auth_credentials_store="file"', ...config].flatMap((c) => ['-c', c])];
  const child = spawn(executable(), args, { cwd, env: codexEnv(env, home), windowsHide: true, stdio: 'pipe' });
  const client = new StdioCodex(child);
  const abort = () => { void client.close(); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    await client.request('initialize', { clientInfo: { name: 'accio', title: 'accio', version: '0.1.0' }, ...(experimental ? { capabilities: { experimentalApi: true } } : {}) });
    child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    return client;
  } catch (error) {
    await client.close();
    throw error;
  } finally { signal?.removeEventListener('abort', abort); }
};

class StdioCodex implements CodexClient {
  private nextId = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private listeners = new Set<(event: CodexNotification) => void>();
  private exits = new Set<(error: Error) => void>();
  private ended?: Error;
  private closed: Promise<void>;
  private closing?: Promise<void>;
  private requestHandler?: (method: string, params: Record<string, any>) => Promise<unknown>;

  constructor(private child: ChildProcessWithoutNullStreams) {
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.method && msg.id !== undefined) {
          // Only the machine adapter registers a narrowly scoped client tool handler.
          const respond = (response: object) => { if (!this.ended) child.stdin.write(JSON.stringify({ id: msg.id, ...response }) + '\n'); };
          if (this.requestHandler) {
            void Promise.resolve().then(() => this.requestHandler!(msg.method, msg.params ?? {})).then(
              result => respond({ result }), () => respond({ error: { code: -32601, message: 'Unsupported or expired Accio tool request' } }),
            );
          } else respond({ error: { code: -32601, message: 'accio does not implement this client request' } });
        } else if (msg.id !== undefined) {
          const p = this.pending.get(msg.id);
          if (!p) return;
          this.pending.delete(msg.id); clearTimeout(p.timer);
          if (msg.error) p.reject(new Error(msg.error.message ?? 'Codex request failed'));
          else p.resolve(msg.result);
        } else if (msg.method) {
          for (const listener of this.listeners) listener(msg);
        }
      } catch { this.fail(new Error('Codex sent an invalid app-server message')); }
    });
    // Drain diagnostics without exposing credentials in logs or user-facing errors.
    child.stderr.resume();
    child.stdin.on('error', () => this.fail(new Error('Codex app-server connection closed')));
    child.once('error', () => this.fail(new Error('Could not start the bundled Codex app-server')));
    this.closed = new Promise((resolve) => child.once('close', (code) => {
      lines.close(); this.fail(new Error(`Codex app-server exited (${code ?? 'signal'})`)); resolve();
    }));
  }

  request<T>(method: string, params: unknown = {}): Promise<T> {
    if (this.ended) return Promise.reject(this.ended);
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); reject(new Error(`Codex ${method} timed out`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }

  onNotification(listener: (event: CodexNotification) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  onRequest(handler: (method: string, params: Record<string, any>) => Promise<unknown>) {
    this.requestHandler = handler;
    return () => { if (this.requestHandler === handler) this.requestHandler = undefined; };
  }
  onExit(listener: (error: Error) => void) {
    if (this.ended) listener(this.ended); else this.exits.add(listener);
    return () => { this.exits.delete(listener); };
  }
  private fail(error: Error) {
    if (this.ended) return;
    this.ended = error;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear();
    for (const listener of this.exits) listener(error);
  }
  close(): Promise<void> {
    return this.closing ??= (async () => {
      this.child.stdin.end();
      const timer = setTimeout(() => this.child.kill(), 3000);
      try { await this.closed; } finally { clearTimeout(timer); }
    })();
  }
}

export async function codexInstall(): Promise<{ harnessId: 'codex'; version: string | null }> {
  try {
    await access(executable());
    const pkg = JSON.parse(await readFile(join(dirname(launcher()), '..', 'package.json'), 'utf8'));
    return { harnessId: 'codex', version: pkg.version };
  } catch { return { harnessId: 'codex', version: null }; }
}
