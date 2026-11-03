import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * The hub's own JSON file, readable by your user only. Atomic, serialised
 * writes; retries the rename Windows refuses while a file is briefly held.
 * (The hub is its own package so it can later run alone, always on.)
 */
export class SecretFile<T> {
  private queue: Promise<void> = Promise.resolve();
  private seq = 0;

  constructor(
    readonly path: string,
    private fallback: () => T,
  ) {}

  async read(): Promise<T> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return this.fallback();
      throw err;
    }
  }

  idle(): Promise<void> {
    return this.queue.catch(() => {});
  }

  write(value: T): Promise<void> {
    const body = JSON.stringify(value, null, 2);
    const run = async () => {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const tmp = `${this.path}.${process.pid}.${this.seq++}.tmp`;
      await writeFile(tmp, body, { mode: 0o600 });
      for (let attempt = 0; ; attempt++) {
        try {
          await rename(tmp, this.path);
          return;
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (attempt >= 8 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) {
            await rm(tmp, { force: true });
            throw err;
          }
          await sleep(20 * (attempt + 1));
        }
      }
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }
}
