// The part of Accio's packages/codex the Sorting Hat needs for ChatGPT accounts:
// starting the bundled Codex app-server in an account's own credential home. It
// imports nothing from Accio (ADR 0018), so it carries its own copy. It never
// starts a Codex thread or turn.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';

export type CodexNotification = { method: string; params: Record<string, any> };
export interface CodexClient {
  request<T = any>(method: string, params?: unknown): Promise<T>;
  onNotification(listener: (event: CodexNotification) => void): () => void;
  onExit(listener: (error: Error) => void): () => void;
  close(): Promise<void>;
}
export type CodexFactory = (options: { home: string; cwd?: string; signal?: AbortSignal }) => Promise<CodexClient>;

/** Remove inherited provider credentials and configuration before choosing the credential home. */
function codexEnv(base: NodeJS.ProcessEnv, home: string): NodeJS.ProcessEnv {
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
export const startCodex: CodexFactory = async ({ home, cwd, signal }) => {
  if (signal?.aborted) throw new Error('Codex was interrupted before starting');
  const args = ['app-server', '-c', 'cli_auth_credentials_store="file"'];
  const child = spawn(executable(), args, { cwd, env: codexEnv(process.env, home), windowsHide: true, stdio: 'pipe' });
  const client = new StdioCodex(child);
  const abort = () => { void client.close(); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    // The client name Codex reports upstream; unchanged from when the hub held accounts.
    await client.request('initialize', { clientInfo: { name: 'accio', title: 'accio', version: '0.1.0' } });
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

  constructor(private child: ChildProcessWithoutNullStreams) {
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.method && msg.id !== undefined) {
          if (!this.ended) child.stdin.write(JSON.stringify({ id: msg.id, error: { code: -32601, message: 'The Sorting Hat does not implement this client request' } }) + '\n');
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
    // Process exit is authoritative even if descendants keep its pipes open.
    child.once('exit', (code) => this.fail(new Error(`Codex app-server exited (${code ?? 'signal'})`)));
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
      // `close` waits for stdio too: descendants can hold those handles open
      // after the app-server exits, even after kill(). Never pin a caller on them.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          this.fail(new Error('Codex app-server connection closed'));
          try { this.child.kill(); } catch { /* The child may have already exited. */ } finally {
            this.child.stdin.destroy();
            this.child.stdout.destroy();
            this.child.stderr.destroy();
            resolve();
          }
        }, 3000);
      });
      this.child.stdin.end();
      try { await Promise.race([this.closed, deadline]); } finally { clearTimeout(timer); }
    })();
  }
}
