import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkerProcess } from './workerProcess.js';

function child() {
  return Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(), connected: true,
    send: vi.fn(), kill: vi.fn(),
  });
}
afterEach(() => vi.useRealTimers());

it('reads split readiness and reports unexpected death after readiness', async () => {
  const fake = child();
  const died = vi.fn();
  const worker = new WorkerProcess(fake as unknown as ChildProcess, died);
  fake.stdout.emit('data', Buffer.from('ACCIO_RE'));
  fake.stdout.emit('data', Buffer.from('ADY {"url":"http://local'));
  fake.stdout.emit('data', Buffer.from('host:1","token":"key"}\n'));
  expect(await worker.ready).toEqual({ url: 'http://localhost:1', token: 'key' });
  fake.emit('exit', 2, null);
  expect(died).toHaveBeenCalledWith(expect.objectContaining({ message: 'accio worker exited (2)' }));
});

it('rejects early exit and spawn errors', async () => {
  const fake = child();
  const worker = new WorkerProcess(fake as unknown as ChildProcess, vi.fn());
  fake.emit('error', new Error('cannot spawn'));
  await expect(worker.ready).rejects.toThrow('cannot spawn');
  const next = child();
  const early = new WorkerProcess(next as unknown as ChildProcess, vi.fn());
  next.emit('exit', 1, null);
  await expect(early.ready).rejects.toThrow('exited (1)');
});

it('waits for graceful IPC shutdown once and does not report expected exit', async () => {
  const fake = child();
  const died = vi.fn();
  const worker = new WorkerProcess(fake as unknown as ChildProcess, died);
  fake.stdout.emit('data', Buffer.from('ACCIO_READY {"url":"http://localhost:1","token":"key"}\n'));
  await worker.ready;
  const closing = worker.close();
  expect(worker.close()).toBe(closing);
  expect(fake.send).toHaveBeenCalledOnce();
  let finished = false;
  void closing.then(() => { finished = true; });
  await Promise.resolve();
  expect(finished).toBe(false);
  fake.emit('exit', 0, null);
  await closing;
  expect(fake.kill).not.toHaveBeenCalled();
  expect(died).not.toHaveBeenCalled();
});

it('bounds shutdown when a child ignores the request', async () => {
  vi.useFakeTimers();
  const fake = child();
  const worker = new WorkerProcess(fake as unknown as ChildProcess, vi.fn(), 100);
  const closing = worker.close();
  await vi.advanceTimersByTimeAsync(100);
  await closing;
  expect(fake.kill).toHaveBeenCalledWith('SIGKILL');
});
