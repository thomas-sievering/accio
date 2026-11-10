// A copy of the JsonFile and JsonStore in Accio's packages/persistence: the Sorting Hat
// imports nothing from Accio (ADR 0018), so it carries its own.
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * One JSON document on disk. Writes go to a temp file first and are renamed
 * into place, so readers see a complete document. Writes are serialised per
 * instance. New directories/files are private to the current user.
 */
export class JsonFile<T> {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    readonly path: string,
    private fallback: () => T,
    private mode = 0o600,
    /** Indentation, as JSON.stringify takes it; 0 writes one line. */
    private space = 2,
  ) {}

  async read(): Promise<T> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return this.fallback();
      throw err;
    }
  }

  /** Whether the document is on disk yet; `read()` returns the fallback otherwise. */
  exists(): Promise<boolean> {
    return JsonFile.exists(this.path);
  }

  static async exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }

  /** Resolves once every write started so far has finished. */
  idle(): Promise<void> {
    return this.queue.catch(() => {});
  }

  write(value: T): Promise<void> {
    const body = JSON.stringify(value, null, this.space);
    const run = async () => {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const tmp = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await writeFile(tmp, body, { mode: this.mode, flag: 'wx' });
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

/**
 * A JsonFile with its current document in memory and a queue that runs one
 * mutation at a time, in order. `commit` publishes a document only once it is
 * on disk, so a failed write leaves the last good one in place, and a failed
 * mutation does not stall the ones queued behind it.
 */
export class JsonStore<T> {
  readonly file: JsonFile<T>;
  data: T;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(path: string, fallback: () => T) {
    this.file = new JsonFile(path, fallback);
    this.data = fallback();
  }

  async load(): Promise<T> {
    this.data = await this.file.read();
    return this.data;
  }

  change<R>(run: () => Promise<R>): Promise<R> {
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  async commit(next: T): Promise<void> {
    await this.file.write(next);
    this.data = next;
  }

  /** Resolves once every mutation queued and write started so far has finished. */
  async idle(): Promise<void> {
    await this.queue;
    await this.file.idle();
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
