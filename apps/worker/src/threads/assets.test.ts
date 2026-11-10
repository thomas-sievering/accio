import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, readFile, rename, rm, stat, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThreadAssets } from './assets.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8foAAAAASUVORK5CYII=', 'base64');

describe('thread-owned media and file capabilities', () => {
  let home: string;
  let cwd: string;
  let assets: ThreadAssets;
  let threads: Set<string>;
  let server: Server;
  let origin: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'accio-assets-'));
    cwd = join(home, 'repo');
    await mkdir(cwd);
    threads = new Set(['thread-one', 'thread-two']);
    assets = new ThreadAssets(home, (id) => threads.has(id));
    server = createServer((req, res) => {
      void assets.handle(req, res).then((handled) => {
        if (!handled) res.writeHead(404).end('other');
      });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  const get = (url: string, init?: RequestInit) => fetch(origin + url, init);

  it('persists immutable bytes through source edits, deletion and server restart', async () => {
    const source = join(cwd, 'original.png');
    await writeFile(source, PNG);
    const binding = await assets.snapshot('thread-one', cwd, 'original.png');
    expect(binding.asset).toMatchObject({ name: 'original.png', mimeType: 'image/png', sizeBytes: PNG.length });
    const first = await assets.assetUrl('thread-one', binding.asset!.id);
    expect(first.url).toMatch(/^\/thread-assets\/[a-zA-Z0-9_-]{43}$/);
    expect(await (await get(first.url)).bytes()).toEqual(new Uint8Array(PNG));
    await writeFile(source, 'source changed');
    expect(await (await get(first.url)).bytes()).toEqual(new Uint8Array(PNG));
    await rm(source);
    assets = new ThreadAssets(home, (id) => threads.has(id));
    expect((await get(first.url)).status).toBe(404);
    const renewed = await assets.assetUrl('thread-one', binding.asset!.id);
    expect(await (await get(renewed.url)).bytes()).toEqual(new Uint8Array(PNG));
    expect(await readFile(join(home, 'thread-content', 'thread-one', 'assets', `${binding.asset!.id}.bin`))).toEqual(PNG);
  });

  it('takes ownership of imported buffers before yielding', async () => {
    const providerBuffer = Buffer.from(PNG);
    const importing = assets.importMedia('thread-one', providerBuffer, 'image/png');
    providerBuffer.fill(0);
    const asset = await importing;
    const { url } = await assets.assetUrl('thread-one', asset.id);
    expect(await (await get(url)).bytes()).toEqual(new Uint8Array(PNG));
  });

  it('issues thread-scoped grants, rejects missing assets and expires capabilities', async () => {
    const asset = await assets.importMedia('thread-one', PNG, 'image/png');
    await expect(assets.assetUrl('thread-two', asset.id)).rejects.toThrow();
    await expect(assets.assetUrl('missing-thread', asset.id)).rejects.toThrow('No such thread');
    await expect(assets.assetUrl('thread-one', 'missing-asset')).rejects.toThrow();
    await expect(assets.assetUrl('thread-one', '../thread-two')).rejects.toThrow('Invalid');
    const grant = await assets.assetUrl('thread-one', asset.id);
    expect(await get(grant.url + 'x')).toHaveProperty('status', 404);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 11 * 60 * 1000);
    expect((await get(grant.url)).status).toBe(404);
  });

  it('checks thread existence and missing bytes on every HTTP request', async () => {
    const asset = await assets.importMedia('thread-one', PNG, 'image/png');
    const grant = await assets.assetUrl('thread-one', asset.id);
    threads.delete('thread-one');
    expect((await get(grant.url)).status).toBe(404);
    threads.add('thread-one');
    const next = await assets.assetUrl('thread-one', asset.id);
    await rm(join(home, 'thread-content', 'thread-one', 'assets', `${asset.id}.bin`));
    expect((await get(next.url)).status).toBe(404);
  });

  it('serves valid GET/HEAD, byte and suffix ranges without exposing active content', async () => {
    const asset = await assets.importMedia('thread-one', PNG, 'image/png', 'a "test".png');
    const { url } = await assets.assetUrl('thread-one', asset.id);
    const head = await get(url, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(String(PNG.length));
    expect(await head.text()).toBe('');
    expect(head.headers.get('content-type')).toBe('image/png');
    expect(head.headers.get('content-disposition')).toContain('inline; filename="a _test_.png"');
    expect(head.headers.get('x-content-type-options')).toBe('nosniff');
    expect(head.headers.get('content-security-policy')).toContain('sandbox');
    const part = await get(url, { headers: { range: 'bytes=8-15' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 8-15/${PNG.length}`);
    expect(await part.bytes()).toEqual(new Uint8Array(PNG.subarray(8, 16)));
    const tail = await get(url, { headers: { range: 'bytes=-9' } });
    expect(tail.status).toBe(206);
    expect(await tail.bytes()).toEqual(new Uint8Array(PNG.subarray(-9)));
    const open = await get(url, { headers: { range: 'bytes=12-' } });
    expect(await open.bytes()).toEqual(new Uint8Array(PNG.subarray(12)));
    const hugeEnd = await get(url, { headers: { range: 'bytes=0-999999' } });
    expect(hugeEnd.status).toBe(206);
    expect(await hugeEnd.bytes()).toEqual(new Uint8Array(PNG));
    const partialHead = await get(url, { method: 'HEAD', headers: { range: 'bytes=1-3' } });
    expect(partialHead.status).toBe(206);
    expect(partialHead.headers.get('content-length')).toBe('3');
    expect(await partialHead.text()).toBe('');
    for (const range of ['bytes=999999-', 'bytes=9-1', 'bytes=-0', 'bytes=0-1,3-4', 'items=0-1', 'bytes=-', 'bytes=999999999999999999999-']) {
      const response = await get(url, { headers: { range } });
      expect(response.status).toBe(416);
      expect(response.headers.get('content-range')).toBe(`bytes */${PNG.length}`);
    }
    expect((await get(url, { method: 'POST' })).status).toBe(405);
    expect((await get('/thread-assets/missing')).status).toBe(404);
    const download = await assets.assetUrl('thread-one', asset.id, true);
    expect((await get(download.url)).headers.get('content-disposition')).toContain('attachment;');
  });

  it('does not mistake HTML, SVG or a mismatched image MIME for raster media', async () => {
    for (const bytes of [Buffer.from('<!doctype html><script>alert(1)</script>'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')]) {
      await expect(assets.importMedia('thread-one', bytes, 'image/png', 'renamed.png')).rejects.toThrow('media');
    }
    await expect(assets.importMedia('thread-one', PNG, 'image/jpeg')).rejects.toThrow('media');
    await writeFile(join(cwd, 'renamed.png'), '<html>active</html>');
    expect(await assets.snapshot('thread-one', cwd, 'renamed.png')).toMatchObject({ error: expect.stringContaining('media') });
    await writeFile(join(cwd, 'vector.svg'), '<svg/>');
    expect(await assets.snapshot('thread-one', cwd, 'vector.svg')).toMatchObject({ error: 'Unsupported local media type.' });
  });

  it('accepts signature-checked common audio/video and refuses spoofed content', async () => {
    const wav = Buffer.alloc(44);
    wav.write('RIFF', 0); wav.write('WAVE', 8);
    const mp4 = Buffer.alloc(24);
    mp4.writeUInt32BE(24, 0); mp4.write('ftyp', 4); mp4.write('isom', 8); mp4.write('mp42', 16);
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from('...webm...')]);
    for (const [bytes, mime] of [[wav, 'audio/wav'], [mp4, 'video/mp4'], [mp4, 'audio/mp4'], [webm, 'video/webm']] as const) {
      const asset = await assets.importMedia('thread-one', bytes, mime);
      expect(asset.mimeType).toBe(mime);
      const { url } = await assets.assetUrl('thread-one', asset.id);
      expect(await (await get(url)).bytes()).toEqual(new Uint8Array(bytes));
    }
    await expect(assets.importMedia('thread-one', Buffer.from('<html>video</html>'), 'video/mp4')).rejects.toThrow();
  });

  it('snapshots bounded base64 data media and reports malformed or unsupported data', async () => {
    const source = `data:image/png;base64,${PNG.toString('base64')}`;
    const binding = await assets.snapshot('thread-one', cwd, source);
    expect(binding).toMatchObject({ source, asset: { mimeType: 'image/png', sizeBytes: PNG.length } });
    const { url } = await assets.assetUrl('thread-one', binding.asset!.id);
    expect(await (await get(url)).bytes()).toEqual(new Uint8Array(PNG));
    for (const source of ['data:image/png;base64,!!!!', 'data:image/png;base64,a===', 'data:image/png,<svg/>', 'data:text/html;base64,PGh0bWw+']) {
      expect(await assets.snapshot('thread-one', cwd, source)).toHaveProperty('error');
    }
  });

  it('bounds local media before reading bytes and supplies explicit failure bindings', async () => {
    await writeFile(join(cwd, 'huge.png'), '');
    await truncate(join(cwd, 'huge.png'), 10 * 1024 * 1024 + 1);
    expect(await assets.snapshot('thread-one', cwd, 'huge.png')).toMatchObject({ source: 'huge.png', error: expect.stringContaining('10 MiB') });
    expect(await assets.snapshot('thread-one', cwd, 'missing.png')).toMatchObject({ source: 'missing.png', error: expect.stringContaining('missing') });
    expect(await assets.snapshot('thread-one', cwd, 'data.json')).toHaveProperty('error', 'Unsupported local media type.');
    await writeFile(join(cwd, 'huge.mp4'), '');
    await truncate(join(cwd, 'huge.mp4'), 100 * 1024 * 1024 + 1);
    expect(await assets.snapshot('thread-one', cwd, 'huge.mp4')).toMatchObject({ error: expect.stringContaining('100 MiB') });
    await expect(assets.fileUrl('thread-one', cwd, 'huge.mp4')).rejects.toThrow('100 MiB');
  });

  it('allows explicit absolute/file paths while rejecting traversal, directories and network sources', async () => {
    const outside = join(home, 'outside.png');
    await writeFile(outside, PNG);
    expect(await assets.snapshot('thread-one', cwd, '../outside.png')).toMatchObject({ error: expect.stringContaining('escapes') });
    expect((await assets.snapshot('thread-one', cwd, outside)).asset).toBeDefined();
    expect((await assets.snapshot('thread-one', cwd, pathToFileURL(outside).href)).asset).toBeDefined();
    for (const source of ['\\\\server\\share\\photo.png', '//server/share/photo.png', 'file://server/share/photo.png', 'https://example.com/photo.png', 'javascript:photo.png']) {
      expect(await assets.snapshot('thread-one', cwd, source)).toHaveProperty('error');
      await expect(assets.fileUrl('thread-one', cwd, source)).rejects.toThrow();
    }
    await mkdir(join(cwd, 'dir.png'));
    expect(await assets.snapshot('thread-one', cwd, 'dir.png')).toMatchObject({ error: expect.stringContaining('regular file') });
    await expect(assets.importMedia('../outside', PNG, 'image/png')).rejects.toThrow('Invalid');
  });

  it('decodes Markdown destinations before checking containment and ignores media/link fragments', async () => {
    await writeFile(join(cwd, 'a b.png'), PNG);
    for (const source of ['a%20b.png', 'a%20b.png#t=1', 'a%20b.png?cache=1#view', pathToFileURL(join(cwd, 'a b.png')).href + '#view']) {
      expect(await assets.snapshot('thread-one', cwd, source)).toMatchObject({ source, asset: { mimeType: 'image/png' } });
    }
    await writeFile(join(cwd, 'notes.md'), 'current notes');
    const { url } = await assets.fileUrl('thread-one', cwd, 'notes.md#L12');
    expect(await (await get(url)).text()).toBe('current notes');
    await writeFile(join(home, 'outside.png'), PNG);
    expect(await assets.snapshot('thread-one', cwd, '%2e%2e%2foutside.png')).toMatchObject({ error: expect.stringContaining('escapes') });
    expect(await assets.snapshot('thread-one', cwd, '%2f%2fserver/share.png')).toMatchObject({ error: expect.stringContaining('network') });
    await expect(assets.fileUrl('thread-one', cwd, 'http%3a%2f%2fserver/file')).rejects.toThrow('scheme');
  });

  it('rejects symlink/junction escapes and replacement after a file grant', async () => {
    const outside = join(home, 'external');
    await mkdir(outside);
    await writeFile(join(outside, 'secret.png'), PNG);
    await symlink(outside, join(cwd, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(await assets.snapshot('thread-one', cwd, 'link/secret.png')).toMatchObject({ error: expect.stringContaining('Symbolic links') });
    await expect(assets.fileUrl('thread-one', cwd, 'link/secret.png')).rejects.toThrow('Symbolic links');
    await mkdir(join(cwd, 'normal'));
    await writeFile(join(cwd, 'normal', 'secret.png'), PNG);
    const { url } = await assets.fileUrl('thread-one', cwd, 'normal/secret.png');
    await rename(join(cwd, 'normal'), join(cwd, 'old'));
    await symlink(outside, join(cwd, 'normal'), process.platform === 'win32' ? 'junction' : 'dir');
    expect((await get(url)).status).toBe(404);
  });

  it('embeds absolute paths through system links such as macOS /tmp, but not a linked file', async () => {
    const real = join(home, 'private-tmp');
    await mkdir(real);
    await writeFile(join(real, 'shot.png'), PNG);
    await symlink(real, join(home, 'tmp'), process.platform === 'win32' ? 'junction' : 'dir');
    const source = join(home, 'tmp', 'shot.png');
    expect(await assets.snapshot('thread-one', cwd, source)).toMatchObject({ source, asset: { mimeType: 'image/png' } });
    const { url } = await assets.fileUrl('thread-one', cwd, source);
    expect((await get(url)).status).toBe(200);
    if (process.platform !== 'win32') {
      await symlink(join(real, 'shot.png'), join(real, 'alias.png'));
      expect(await assets.snapshot('thread-one', cwd, join(home, 'tmp', 'alias.png'))).toMatchObject({ error: expect.stringContaining('Symbolic links') });
    }
  });

  it('opens current ordinary files as safe attachments rather than taking snapshots', async () => {
    const source = join(cwd, 'current.html');
    await writeFile(source, '<h1>one</h1>');
    const grant = await assets.fileUrl('thread-one', cwd, 'current.html');
    await writeFile(source, '<h1>two</h1>');
    const response = await get(grant.url);
    expect(await response.text()).toBe('<h1>two</h1>');
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(response.headers.get('content-disposition')).toContain('attachment; filename="current.html"');
    const head = await get(grant.url, { method: 'HEAD' });
    expect(head.headers.get('content-length')).toBe('12');
    expect(await head.text()).toBe('');
    await rm(source);
    expect((await get(grant.url)).status).toBe(404);
    await writeFile(source, '');
    const empty = await assets.fileUrl('thread-one', cwd, 'current.html');
    expect(await (await get(empty.url)).text()).toBe('');
    expect((await get(empty.url, { headers: { range: 'bytes=0-' } })).status).toBe(416);
  });

  it('revokes grants and removes only owned thread content', async () => {
    const one = await assets.importMedia('thread-one', PNG, 'image/png');
    const two = await assets.importMedia('thread-two', PNG, 'image/png');
    const grant = await assets.assetUrl('thread-one', one.id);
    await assets.delete('thread-one');
    expect((await get(grant.url)).status).toBe(404);
    await expect(stat(join(home, 'thread-content', 'thread-one'))).rejects.toThrow();
    const other = await assets.assetUrl('thread-two', two.id);
    expect((await get(other.url)).status).toBe(200);
    await assets.delete('thread-one');
    await expect(assets.delete('../')).rejects.toThrow('Invalid');
  });

  it('rejects asset storage symlink redirection and unsafe recursive cleanup', async () => {
    const outside = join(home, 'external');
    await mkdir(outside);
    await writeFile(join(outside, 'keep.txt'), 'keep');
    await mkdir(join(home, 'thread-content'));
    await symlink(outside, join(home, 'thread-content', 'thread-one'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(assets.importMedia('thread-one', PNG, 'image/png')).rejects.toThrow('Unsafe');
    await expect(assets.delete('thread-one')).rejects.toThrow('Unsafe');
    expect(await readFile(join(outside, 'keep.txt'), 'utf8')).toBe('keep');
  });
});
