import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { IMAGE_ATTACHMENT_BYTES, IMAGE_TYPES, type ThreadAsset } from '@accio/protocol';
import { UserError } from '../rpc/router.js';
import { checkedMime, type ThreadAssets } from './assets.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STALE_MS = 24 * 60 * 60 * 1000;

type Pending = { name: string; mimeType: string };

/**
 * GLOSSARY: Image attachment. Pasted images wait here, on the machine whose client
 * pasted them, until a message sends them; a draft has no thread to hold them yet.
 * Sending copies them into the thread's assets. Unsent ones are swept after a day.
 */
export class Uploads {
  private readonly dir: string;
  private swept = 0;

  constructor(home: string) {
    this.dir = join(home, 'uploads');
  }

  async add(input: { name: string; mimeType: string; data: string }): Promise<{ uploadId: string }> {
    if (!(IMAGE_TYPES as readonly string[]).includes(input.mimeType)) throw new UserError('Paste a PNG, JPEG, GIF or WebP image.');
    const bytes = Buffer.from(input.data, 'base64');
    if (!bytes.byteLength) throw new UserError('The image is empty.');
    if (bytes.byteLength > IMAGE_ATTACHMENT_BYTES) throw new UserError(`Images must be under ${(IMAGE_ATTACHMENT_BYTES / 1_000_000).toFixed(1)} MB.`);
    let mimeType: string;
    try { mimeType = checkedMime(bytes.subarray(0, 4096), input.mimeType); }
    catch { throw new UserError('This image is damaged or not the type it claims to be.'); }
    void this.sweep();
    const uploadId = randomUUID();
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await writeFile(join(this.dir, `${uploadId}.json`), JSON.stringify({ name: input.name || 'image', mimeType } satisfies Pending), { flag: 'wx', mode: 0o600 });
    await writeFile(join(this.dir, `${uploadId}.bin`), bytes, { flag: 'wx', mode: 0o600 });
    return { uploadId };
  }

  /** Copies each upload into the thread's assets, in order. The uploads stay until `release`, so a refused send can be sent again. */
  async claim(threadId: string, uploadIds: readonly string[], assets: ThreadAssets): Promise<ThreadAsset[]> {
    const claimed: ThreadAsset[] = [];
    for (const id of uploadIds) {
      if (!UUID.test(id)) throw new UserError('An image in this message is no longer available. Paste it again.');
      let pending: Pending;
      let bytes: Buffer;
      try {
        pending = JSON.parse(await readFile(join(this.dir, `${id}.json`), 'utf8')) as Pending;
        bytes = await readFile(join(this.dir, `${id}.bin`));
      } catch { throw new UserError('An image in this message is no longer available. Paste it again.'); }
      claimed.push(await assets.importMedia(threadId, bytes, pending.mimeType, pending.name));
    }
    return claimed;
  }

  /** Forgets uploads a message has sent. */
  async release(uploadIds: readonly string[]): Promise<void> {
    await Promise.all(uploadIds.filter((id) => UUID.test(id)).flatMap((id) => [`${id}.json`, `${id}.bin`].map((file) => rm(join(this.dir, file), { force: true }).catch(() => {}))));
  }

  /** At most hourly, removes uploads no message sent within a day. */
  async sweep(now = Date.now()): Promise<void> {
    if (now - this.swept < 60 * 60 * 1000) return;
    this.swept = now;
    const files = await readdir(this.dir).catch(() => [] as string[]);
    await Promise.all(files.map(async (file) => {
      const path = join(this.dir, file);
      const info = await stat(path).catch(() => undefined);
      if (info && now - info.mtimeMs > STALE_MS) await rm(path, { force: true }).catch(() => {});
    }));
  }
}
