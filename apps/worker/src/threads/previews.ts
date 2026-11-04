import { fork, type ChildProcess } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { JsonFile } from '@accio/persistence';
import { UserError } from '../rpc/router.js';
import { cleanExecutionEnv } from './harnessEnv.js';

type Preview = { pid: number; port: number };

/** Only commands started here belong to Accio. Never stop a process by name or port. */
export class Previews {
  private file: JsonFile<Record<string, Preview>>;
  private records: Record<string, Preview> = {};
  private children = new Map<string, ChildProcess>();
  constructor(private home: string) { this.file = new JsonFile(join(home, 'previews.json'), () => ({})); }
  async load() { this.records = await this.file.read(); }

  async open(threadId: string, cwd: string, command: string): Promise<string> {
    const previous = this.records[threadId];
    if (previous && this.children.has(threadId) && alive(previous.pid)) {
      if (!await listening(previous.port)) throw new UserError('The preview is running but is not responding yet. Try Open app again.');
      return `http://127.0.0.1:${previous.port}`;
    }
    if (previous && alive(previous.pid)) throw new UserError('The previous preview is still stopping after a restart. Try again once it exits.');
    const port = await freePort();
    const runner = new URL(import.meta.url.endsWith('.ts') ? './previewRunner.ts' : './previewRunner.js', import.meta.url);
    const child = fork(fileURLToPath(runner), [cwd, command, String(port)], {
      windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      execArgv: runner.pathname.endsWith('.ts') ? ['--import', 'tsx'] : [],
      env: { ...cleanExecutionEnv(process.env), PORT: String(port), HOST: '127.0.0.1', ACCIO_HOME: join(this.home, 'preview-state', threadId), ACCIO_PORT: '0', ACCIO_HUB_PORT: '0' },
    });
    let failure = '';
    child.on('error', () => { failure = 'Could not start the preview command.'; });
    child.on('message', (m: any) => { if (m?.error) failure = m.error; });
    this.children.set(threadId, child);
    this.records[threadId] = { pid: child.pid!, port };
    try {
      await this.file.write(this.records);
      const url = `http://127.0.0.1:${port}`;
      for (let attempt = 0; attempt < 100; attempt++) {
        if (failure || child.exitCode !== null || child.signalCode !== null) throw new UserError(failure || 'The preview command exited before the app was ready.');
        try {
          await fetch(url, { signal: AbortSignal.timeout(300), redirect: 'manual' });
          return url;
        } catch { await delay(200); }
      }
      throw new UserError('The preview did not listen on its assigned PORT. Use {port} in the project’s preview command if needed.');
    } catch (error) { await this.stop(threadId); throw error; }
  }

  /** Whether a preview Accio started for this thread is still alive, including one still exiting after a restart. */
  has(threadId: string) { const record = this.records[threadId]; return !!record && alive(record.pid); }

  async stop(threadId: string) {
    const record = this.records[threadId];
    const child = this.children.get(threadId);
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
      if (child.connected) child.send({ type: 'stop' });
      await Promise.race([exited, delay(10_000)]);
      if (child.exitCode === null && child.signalCode === null) throw new UserError('The owned preview has not stopped. The workspace has been kept.');
    } else if (!child && record && alive(record.pid)) {
      throw new UserError('A preview from the previous server is still exiting. The workspace has been kept.');
    }
    if (record) {
      for (let attempt = 0; attempt < 10 && await listening(record.port); attempt++) await delay(100);
      if (await listening(record.port)) throw new UserError('The preview port is still in use. The workspace has been kept.');
    }
    this.children.delete(threadId);
    delete this.records[threadId];
    await this.file.write(this.records);
  }

  async close() {
    await Promise.allSettled(Object.keys(this.records).map(id => this.stop(id)));
    await this.file.idle();
  }
}

function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
function listening(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (connected: boolean) => { socket.destroy(); resolve(connected); };
    socket.once('connect', () => finish(true)); socket.once('error', () => finish(false)); socket.setTimeout(300, () => finish(false));
  });
}
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}
