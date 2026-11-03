import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';

const processMock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: processMock.spawn }));
import { startCodex } from './index.js';

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

async function connection() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true),
    stdin: new Writable({ write(data, _encoding, done) {
      const message = JSON.parse(String(data));
      if (message.method === 'initialize') queueMicrotask(() => child.stdout.write(JSON.stringify({ id: message.id, result: {} }) + '\n'));
      done();
    } }),
  });
  processMock.spawn.mockReturnValue(child);
  return { child, client: await startCodex({ home: 'test-home' }) };
}

it.each([false, true])('bounds close when stdio stays open (process exited: %s)', async (exited) => {
  vi.useFakeTimers();
  const { child, client } = await connection();
  const pending = client.request('thread/read');
  const rejected = expect(pending).rejects.toThrow(exited ? 'Codex app-server exited (0)' : 'connection closed');
  if (exited) {
    child.emit('exit', 0); // No close event: a descendant still holds stdio.
    await rejected;
  }
  const closing = client.close();
  expect(client.close()).toBe(closing);
  await vi.advanceTimersByTimeAsync(3000);
  await closing;
  await rejected;
  expect(child.kill).toHaveBeenCalledOnce();
  expect(child.stdin.destroyed && child.stdout.destroyed && child.stderr.destroyed).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not kill a normally closed app-server', async () => {
  vi.useFakeTimers();
  const { child, client } = await connection();
  const closing = client.close();
  child.emit('close', 0);
  await closing;
  await vi.advanceTimersByTimeAsync(3000);
  expect(child.kill).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
