import type { ChildProcess } from 'node:child_process';

export type Ready = { url: string; token: string };

/** Owns readiness, unexpected death, and bounded graceful shutdown of one child. */
export class ServerProcess {
  readonly ready: Promise<Ready>;
  private stopping = false;
  private exited = false;
  private exit: Promise<void>;
  private shutdown?: Promise<void>;

  constructor(private child: ChildProcess, onDeath: (error: Error) => void, private timeoutMs = 5000) {
    let exit!: () => void;
    this.exit = new Promise<void>((resolve) => { exit = resolve; });
    this.ready = new Promise((resolve, reject) => {
      let ready = false;
      let buffer = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        if (ready) return;
        buffer += chunk.toString();
        const match = buffer.match(/^ACCIO_READY (.+)$/m);
        if (!match?.[1]) return;
        try {
          const value = JSON.parse(match[1]) as Ready;
          if (typeof value.url !== 'string' || typeof value.token !== 'string') throw new Error('Invalid server readiness message');
          ready = true;
          resolve(value);
        } catch (error) { reject(error); }
      });
      child.once('error', (error) => { reject(error); if (ready && !this.stopping) onDeath(error); });
      child.once('exit', (code, signal) => {
        this.exited = true;
        exit();
        const error = new Error(`accio server exited (${signal ?? code})`);
        if (!ready) reject(error);
        else if (!this.stopping) onDeath(error);
      });
    });
  }

  close(): Promise<void> {
    return this.shutdown ??= this.stop();
  }

  private async stop() {
    this.stopping = true;
    if (this.exited) return;
    // IPC works on Windows too; SIGTERM there does not run Node signal handlers.
    if (this.child.connected) this.child.send({ type: 'shutdown' }, () => {});
    else this.child.kill('SIGTERM');
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([this.exit, new Promise<void>((resolve) => {
      timer = setTimeout(() => { this.child.kill('SIGKILL'); resolve(); }, this.timeoutMs);
    })]);
    clearTimeout(timer);
  }
}
