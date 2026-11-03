import { mkdtemp, readFile, readdir, rm, stat, writeFile as realWriteFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { JsonFile } from './index.js';
import * as fs from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename), writeFile: vi.fn(actual.writeFile) };
});
vi.mock('node:timers/promises', async (original) => {
  const actual = await original<typeof import('node:timers/promises')>();
  return { ...actual, setTimeout: vi.fn(actual.setTimeout) };
});

const homes: string[] = [];
afterEach(async () => {
  vi.mocked(fs.rename).mockReset();
  vi.mocked(fs.rename).mockImplementation((await vi.importActual<typeof fs>('node:fs/promises')).rename);
  vi.mocked(fs.writeFile).mockReset();
  vi.mocked(fs.writeFile).mockImplementation((await vi.importActual<typeof fs>('node:fs/promises')).writeFile);
  vi.mocked(sleep).mockClear();
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'accio-json-'));
  homes.push(home);
  return { home, file: new JsonFile(join(home, 'secret', 'state.json'), () => ({ n: 0 })) };
}

it('serializes atomic replacements, snapshots arguments, and leaves no temporary files', async () => {
  const { home, file } = await setup();
  expect(await file.read()).toEqual({ n: 0 });
  await file.write({ n: 0 });
  const value = { n: 1 };
  const first = file.write(value);
  value.n = 999;
  await first;
  expect(await file.read()).toEqual({ n: 1 });
  const writes = Array.from({ length: 30 }, (_, n) => file.write({ n, text: 'x'.repeat(10000) } as { n: number }));
  // Readers must always see a complete old or new document.
  for (let n = 0; n < 30; n++) expect(typeof (await file.read()).n).toBe('number');
  await Promise.all(writes);
  await file.idle();
  expect((await file.read()).n).toBe(29);
  expect(await readdir(join(home, 'secret'))).toEqual(['state.json']);
  if (process.platform !== 'win32') {
    expect((await stat(join(home, 'secret'))).mode & 0o777).toBe(0o700);
    expect((await stat(file.path)).mode & 0o777).toBe(0o600);
  }
});

it('preserves the last document after a failed replacement and runs the next queued write', async () => {
  const { home, file } = await setup();
  await file.write({ n: 1 });
  vi.mocked(fs.rename).mockRejectedValueOnce(Object.assign(new Error('disk failure'), { code: 'EIO' }));
  const failed = file.write({ n: 2 });
  await expect(failed).rejects.toThrow('disk failure');
  expect(await file.read()).toEqual({ n: 1 });
  expect(await readdir(join(home, 'secret'))).toEqual(['state.json']);
  await file.write({ n: 3 });
  expect(await file.read()).toEqual({ n: 3 });
});

it('cleans a partially written temporary file and recovers its queue', async () => {
  const { home, file } = await setup();
  await file.write({ n: 1 });
  const actual = await vi.importActual<typeof fs>('node:fs/promises');
  vi.mocked(fs.writeFile).mockImplementationOnce(async (path) => {
    await actual.writeFile(path, '{partial');
    throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
  });
  const failed = file.write({ n: 2 });
  const next = file.write({ n: 3 });
  await expect(failed).rejects.toThrow('disk full');
  await next;
  expect(await file.read()).toEqual({ n: 3 });
  expect(await readdir(join(home, 'secret'))).toEqual(['state.json']);
});

it('retries Windows replacement errors with bounded backoff', async () => {
  const { file } = await setup();
  for (const code of ['EPERM', 'EBUSY', 'EACCES']) vi.mocked(fs.rename).mockRejectedValueOnce(Object.assign(new Error(code), { code }));
  await file.write({ n: 1 });
  expect(vi.mocked(sleep).mock.calls.map(([delay]) => delay)).toEqual([20, 40, 60]);
  vi.mocked(fs.rename).mockRejectedValue(Object.assign(new Error('locked'), { code: 'EPERM' }));
  await expect(file.write({ n: 2 })).rejects.toThrow('locked');
  expect(await file.read()).toEqual({ n: 1 });
  expect(await readdir(join(file.path, '..'))).toEqual(['state.json']);
});

it('refuses corrupt JSON rather than resetting it', async () => {
  const { file } = await setup();
  await file.write({ n: 1 });
  await realWriteFile(file.path, '{bad');
  await expect(file.read()).rejects.toThrow();
  expect(await readFile(file.path, 'utf8')).toBe('{bad');
});
