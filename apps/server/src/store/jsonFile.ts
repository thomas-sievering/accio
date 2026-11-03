import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * One JSON document on disk. Writes go to a temp file first and are renamed
 * into place, so a crash never leaves half a file. Writes are serialised.
 */
export class JsonFile<T> {
  private queue: Promise<void> = Promise.resolve();
  private seq = 0;

  constructor(
    readonly path: string,
    private fallback: () => T,
    private mode = 0o600,
  ) {}

  async read(): Promise<T> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return this.fallback();
      throw err;
    }
  }

  /** Resolves once every write started so far has finished. */
  idle(): Promise<void> {
    return this.queue.catch(() => {});
  }

  write(value: T): Promise<void> {
    const body = JSON.stringify(value, null, 2);
    const run = async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.${process.pid}.${this.seq++}.tmp`;
      await writeFile(tmp, body, { mode: this.mode });
      try {
        await renameWithRetry(tmp, this.path);
      } catch (err) {
        await rm(tmp, { force: true });
        throw err;
      }
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }
}

/** Windows refuses to replace a file someone holds open for a moment (EPERM/EBUSY). */
async function renameWithRetry(from: string, to: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 8 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err;
      await sleep(20 * (attempt + 1));
    }
  }
}
