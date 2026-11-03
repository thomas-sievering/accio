import { randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rm, writeFile, type FileHandle } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { mediaMimeType, type AssetUrl, type MediaBinding, type ThreadAsset } from '@accio/protocol';

const IMAGE_LIMIT = 10 * 1024 * 1024;
const MEDIA_LIMIT = 100 * 1024 * 1024;
const FILE_LIMIT = 100 * 1024 * 1024;
const GRANT_MS = 10 * 60 * 1000;
const ID = /^[a-zA-Z0-9_-]{1,128}$/;

type Grant = {
  threadId: string;
  expiresAt: number;
  download: boolean;
} & ({ assetId: string } | { cwd: string; source: string });

/** Files are copied at ingestion, while short-lived URLs are minted only over authenticated RPC. */
export class ThreadAssets {
  private readonly home: string;
  private readonly grants = new Map<string, Grant>();

  constructor(home: string, private readonly exists: (threadId: string) => boolean) {
    this.home = resolve(home);
  }

  async importMedia(threadId: string, data: Uint8Array, mimeType: string, name?: string): Promise<ThreadAsset> {
    this.assertThread(threadId);
    checkSize(data.byteLength, mimeType.toLowerCase().startsWith('image/') ? IMAGE_LIMIT : MEDIA_LIMIT);
    // Own the bytes before yielding; providers can reuse or mutate their input buffers.
    const bytes = Buffer.from(data);
    const mime = checkedMime(bytes.subarray(0, 4096), mimeType);
    checkSize(bytes.byteLength, mime.startsWith('image/') ? IMAGE_LIMIT : MEDIA_LIMIT);
    const asset: ThreadAsset = {
      id: randomUUID(),
      name: safeName(name ?? `media.${extension(mime)}`),
      mimeType: mime,
      sizeBytes: bytes.byteLength,
    };
    const dir = await this.directory(threadId, true);
    const file = join(dir, `${asset.id}.bin`);
    const pending = join(dir, `${asset.id}.pending`);
    try {
      await writeFile(pending, bytes, { flag: 'wx', mode: 0o600 });
      this.assertThread(threadId);
      await rename(pending, file);
      await writeFile(join(dir, `${asset.id}.json`), JSON.stringify(asset), { flag: 'wx', mode: 0o600 });
      this.assertThread(threadId);
      return asset;
    } catch (error) {
      await Promise.all([pending, file, join(dir, `${asset.id}.json`)].map((path) => rm(path, { force: true }).catch(() => {})));
      throw error;
    }
  }

  async snapshot(threadId: string, cwd: string, source: string): Promise<MediaBinding> {
    try {
      this.assertThread(threadId);
      if (/^data:/i.test(source)) {
        const prefix = /^data:([^;,]+);base64,/i.exec(source);
        if (!prefix) throw new Error('Unsupported media data URL. Expected base64 media.');
        const mime = prefix[1]!.toLowerCase();
        const limit = mime.startsWith('image/') ? IMAGE_LIMIT : MEDIA_LIMIT;
        // Check the encoded size before slicing, stripping or decoding a potentially huge value.
        if (source.length - prefix[0].length > Math.ceil(limit / 3) * 4 + 4) throw new Error(`File exceeds the ${limit / 1024 / 1024} MiB limit.`);
        const encoded = source.slice(prefix[0].length);
        if (!encoded || encoded.length % 4 !== 0 || !/^[a-zA-Z0-9+/]*={0,2}$/.test(encoded)) throw new Error('Malformed base64 media data.');
        return { source, asset: await this.importMedia(threadId, Buffer.from(encoded, 'base64'), mime) };
      }
      const mime = mediaMimeType(source);
      if (!mime) throw new Error('Unsupported local media type.');
      const file = await openLocal(cwd, source);
      try {
        const info = await file.handle.stat();
        checkSize(info.size, mime.startsWith('image/') ? IMAGE_LIMIT : MEDIA_LIMIT);
        const bytes = await readBounded(file.handle, info.size);
        return { source, asset: await this.importMedia(threadId, bytes, mime, basename(file.path)) };
      } finally {
        await file.handle.close();
      }
    } catch (error) {
      return { source, error: readableError(error) };
    }
  }

  async assetUrl(threadId: string, assetId: string, download = false): Promise<AssetUrl> {
    this.assertThread(threadId);
    const { handle } = await this.openAsset(threadId, assetId);
    await handle.close();
    return this.grant({ threadId, assetId, download, expiresAt: Date.now() + GRANT_MS });
  }

  /** Caller must first establish that the exact destination is present in this thread's transcript. */
  async fileUrl(threadId: string, cwd: string, source: string): Promise<AssetUrl> {
    this.assertThread(threadId);
    const { handle } = await openLocal(cwd, source);
    try {
      checkSize((await handle.stat()).size, FILE_LIMIT);
    } finally {
      await handle.close();
    }
    return this.grant({ threadId, cwd, source, download: true, expiresAt: Date.now() + GRANT_MS });
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path !== '/thread-assets' && !path.startsWith('/thread-assets/')) return false;
    const token = /^\/thread-assets\/([a-zA-Z0-9_-]+)$/.exec(path)?.[1];
    const grant = token && this.grants.get(token);
    if (!grant || grant.expiresAt <= Date.now() || !this.exists(grant.threadId)) {
      if (token) this.grants.delete(token);
      res.writeHead(404, securityHeaders()).end();
      return true;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...securityHeaders(), allow: 'GET, HEAD' }).end();
      return true;
    }
    let handle: FileHandle | undefined;
    try {
      let mimeType: string;
      let name: string;
      if ('assetId' in grant) {
        const opened = await this.openAsset(grant.threadId, grant.assetId);
        handle = opened.handle;
        mimeType = opened.asset.mimeType;
        name = opened.asset.name;
      } else {
        const opened = await openLocal(grant.cwd, grant.source);
        handle = opened.handle;
        mimeType = 'application/octet-stream';
        name = safeName(basename(opened.path));
        checkSize((await handle.stat()).size, FILE_LIMIT);
      }
      // Deletion can happen while filesystem operations above are in flight.
      this.assertThread(grant.threadId);
      const size = (await handle.stat()).size;
      const headers: Record<string, string | number> = {
        ...securityHeaders(),
        'content-type': mimeType,
        'content-disposition': disposition(grant.download ? 'attachment' : 'inline', name),
        'accept-ranges': 'bytes',
      };
      const range = req.headers.range === undefined ? undefined : parseRange(req.headers.range, size);
      if (range === null) {
        res.writeHead(416, { ...headers, 'content-range': `bytes */${size}`, 'content-length': 0 }).end();
        return true;
      }
      const start = range?.start ?? 0;
      const end = range?.end ?? size - 1;
      headers['content-length'] = Math.max(0, end - start + 1);
      if (range) headers['content-range'] = `bytes ${start}-${end}/${size}`;
      res.writeHead(range ? 206 : 200, headers);
      if (req.method === 'HEAD' || size === 0) res.end();
      else {
        // The verified descriptor, rather than reopening its path, closes the symlink race.
        const stream = handle.createReadStream({ start, end, autoClose: false });
        await pipeline(stream, res);
      }
    } catch {
      if (!res.headersSent) res.writeHead(404, securityHeaders()).end();
      else res.destroy();
    } finally {
      await handle?.close().catch(() => {});
    }
    return true;
  }

  async delete(threadId: string): Promise<void> {
    validId(threadId);
    for (const [token, grant] of this.grants) if (grant.threadId === threadId) this.grants.delete(token);
    const base = join(this.home, 'thread-content');
    const dir = join(base, threadId);
    // Never recursively remove a redirected directory, even when it looks owned by a thread.
    for (const path of [base, dir]) {
      const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (!info) return;
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Unsafe thread asset directory.');
    }
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }

  private assertThread(threadId: string) {
    validId(threadId);
    if (!this.exists(threadId)) throw new Error('No such thread.');
  }

  private grant(grant: Grant): AssetUrl {
    for (const [token, value] of this.grants) if (value.expiresAt <= Date.now()) this.grants.delete(token);
    // Cap in-memory capabilities without retaining a process-lifetime history of opened files.
    if (this.grants.size >= 10_000) this.grants.delete(this.grants.keys().next().value!);
    const token = randomBytes(32).toString('base64url');
    this.grants.set(token, grant);
    return { url: `/thread-assets/${token}`, expiresAt: grant.expiresAt };
  }

  private async directory(threadId: string, create = false): Promise<string> {
    validId(threadId);
    let dir = this.home;
    for (const part of ['thread-content', threadId, 'assets']) {
      dir = join(dir, part);
      if (create) await mkdir(dir, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error;
      });
      const info = await lstat(dir);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Unsafe thread asset directory.');
    }
    return dir;
  }

  private async openAsset(threadId: string, assetId: string): Promise<{ handle: FileHandle; asset: ThreadAsset }> {
    validId(assetId);
    const dir = await this.directory(threadId);
    const metadata = await openRegular(join(dir, `${assetId}.json`));
    let asset: ThreadAsset;
    try {
      const size = (await metadata.stat()).size;
      if (size > 16_384) throw new Error('Invalid asset metadata.');
      asset = JSON.parse((await readBounded(metadata, size)).toString('utf8')) as ThreadAsset;
      if (asset.id !== assetId || typeof asset.name !== 'string' || typeof asset.mimeType !== 'string' ||
        !Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes <= 0) throw new Error('Invalid asset metadata.');
    } finally {
      await metadata.close();
    }
    const handle = await openRegular(join(dir, `${assetId}.bin`));
    try {
      const info = await handle.stat();
      if (info.size !== asset.sizeBytes) throw new Error('Asset bytes have changed.');
      checkSize(info.size, asset.mimeType.startsWith('image/') ? IMAGE_LIMIT : MEDIA_LIMIT);
      const head = Buffer.alloc(Math.min(info.size, 4096));
      await handle.read(head, 0, head.length, 0);
      checkedMime(head, asset.mimeType);
      return { asset, handle };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }
}

function validId(id: string) {
  if (!ID.test(id)) throw new Error('Invalid thread or asset identifier.');
}

function checkSize(size: number, limit: number) {
  if (size < 0 || size > limit) throw new Error(`File exceeds the ${limit / 1024 / 1024} MiB limit.`);
}

function safeName(name: string): string {
  return name.split(/[\\/]/).at(-1)!.replace(/[\u0000-\u001f\u007f]/g, '_').slice(0, 180) || 'file';
}

function disposition(kind: string, name: string) {
  const safe = safeName(name);
  const ascii = safe.replace(/[^\x20-\x7e]|["\\]/g, '_');
  // encodeURIComponent throws for malformed Unicode; replace lone surrogates first.
  const encoded = encodeURIComponent(safe.replace(/[\uD800-\uDFFF]/gu, '\uFFFD')).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function securityHeaders(): Record<string, string> {
  return {
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    'cache-control': 'private, no-store',
    'referrer-policy': 'no-referrer',
  };
}

function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}

/** Only actual media signatures can become inline assets, regardless of an authored filename/MIME. */
function checkedMime(head: Buffer, claimed: string): string {
  const aliases: Record<string, string> = { 'image/jpg': 'image/jpeg', 'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav', 'audio/x-flac': 'audio/flac', 'video/x-m4v': 'video/mp4' };
  const mime = aliases[claimed.toLowerCase()] ?? claimed.toLowerCase();
  const ascii = (start: number, end: number) => head.toString('ascii', start, end);
  let detected: string | undefined;
  if (head.length >= 24 && head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && ascii(12, 16) === 'IHDR') detected = 'image/png';
  else if (head.length >= 4 && head[0] === 255 && head[1] === 216 && head[2] === 255) detected = 'image/jpeg';
  else if (head.length >= 13 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) detected = 'image/gif';
  else if (head.length >= 16 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') detected = 'image/webp';
  else if (head.length >= 16 && ascii(4, 8) === 'ftyp') {
    const brands = ascii(8, Math.min(head.length, Math.min(head.readUInt32BE(0), 256)));
    if (/avif|avis/.test(brands)) detected = 'image/avif';
    else if (/qt  /.test(brands)) detected = 'video/quicktime';
    else if (/M4A |M4B |isom|iso2|mp41|mp42|M4V |dash/.test(brands)) detected = mime === 'audio/mp4' ? 'audio/mp4' : 'video/mp4';
  } else if (head.length >= 8 && head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) && head.includes(Buffer.from('webm'))) detected = mime === 'audio/webm' ? 'audio/webm' : 'video/webm';
  else if (head.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') detected = 'audio/wav';
  else if (head.length >= 27 && ascii(0, 4) === 'OggS') detected = 'audio/ogg';
  else if (head.length >= 4 && ascii(0, 4) === 'fLaC') detected = 'audio/flac';
  else if (head.length >= 4 && head[0] === 255 && ((head[1]! & 0xf6) === 0xf0)) detected = 'audio/aac';
  else if (head.length >= 4 && (ascii(0, 3) === 'ID3' || (head[0] === 255 && (head[1]! & 0xe0) === 0xe0))) detected = 'audio/mpeg';
  if (!detected || detected !== mime) throw new Error('Unsupported media or file content does not match its media type.');
  return detected;
}

function extension(mime: string) {
  return ({ 'image/jpeg': 'jpg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'video/quicktime': 'mov' } as Record<string, string>)[mime] ?? mime.split('/')[1] ?? 'bin';
}

function within(root: string, path: string) {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

async function openLocal(cwd: string, source: string): Promise<{ path: string; handle: FileHandle }> {
  if (!source || source.includes('\0') || source.startsWith('\\\\') || source.startsWith('//')) throw new Error('Blocked local file path.');
  let authored = source;
  if (/^file:/i.test(source)) {
    const url = new URL(source);
    if (url.hostname) throw new Error('Blocked local file URL.');
    url.search = '';
    url.hash = '';
    authored = fileURLToPath(url);
  } else {
    try { authored = decodeURIComponent(source.split(/[?#]/, 1)[0]!); }
    catch { throw new Error('Malformed encoded local file path.'); }
  }
  if (!authored || authored.includes('\0')) throw new Error('Blocked local file path.');
  if (/^[a-z][a-z\d+.-]*:/i.test(authored) && !/^[a-z]:[\\/]/i.test(authored)) throw new Error('Unsupported local file scheme.');
  // Windows device and network paths are never treated as explicit local files.
  if (authored.startsWith('\\\\') || authored.startsWith('//') || /^(?:\\\?\\|\\\.\\)/.test(authored)) throw new Error('Blocked network or device path.');
  if (process.platform !== 'win32' && win32.isAbsolute(authored) && !isAbsolute(authored)) throw new Error('Windows path is not on this machine.');
  const absolute = isAbsolute(authored);
  const root = await realpath(resolve(cwd));
  const target = resolve(root, authored);
  if (!absolute && !within(root, target)) throw new Error('Relative file path escapes its checkout.');
  // Reject symbolic links in the authored path, including links which resolve back inside cwd.
  await assertNoLinks(target, root);
  const canonical = await realpath(target);
  if (!absolute && !within(root, canonical)) throw new Error('Relative file path escapes its checkout.');
  const handle = await openRegular(target);
  try {
    await assertNoLinks(target, root);
    if (await realpath(target) !== canonical) throw new Error('File path changed while opening.');
    return { path: target, handle };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function assertNoLinks(path: string, stop: string) {
  let walk = path;
  while (walk !== dirname(walk)) {
    const info = await lstat(walk);
    if (info.isSymbolicLink()) throw new Error('Symbolic links are not supported for local media.');
    if (walk === stop) break;
    walk = dirname(walk);
  }
}

async function openRegular(path: string): Promise<FileHandle> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('Local path is not a regular file.');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    const after = await lstat(path);
    if (!opened.isFile() || !after.isFile() || after.isSymbolicLink() || opened.dev !== before.dev || opened.ino !== before.ino || opened.dev !== after.dev || opened.ino !== after.ino) throw new Error('File changed while opening.');
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

/** A growing source cannot bypass the stat limit or force an unbounded readFile allocation. */
async function readBounded(handle: FileHandle, size: number): Promise<Buffer> {
  const before = await handle.stat();
  if (before.size !== size) throw new Error('File changed while reading.');
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(bytes, offset, size - offset, offset);
    if (!bytesRead) throw new Error('File changed while reading.');
    offset += bytesRead;
  }
  const after = await handle.stat();
  if (after.size !== size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error('File changed while reading.');
  return bytes;
}

function readableError(error: unknown): string {
  if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return 'Local media file is missing.';
  if ((error as NodeJS.ErrnoException)?.code === 'EACCES' || (error as NodeJS.ErrnoException)?.code === 'EPERM') return 'Local media file is not accessible.';
  return error instanceof Error ? error.message : 'Local media is unavailable.';
}
