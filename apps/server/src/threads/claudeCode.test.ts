import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { claudeCode } from './claudeCode.js';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: queryMock }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function query() {
  const pending = deferred<IteratorResult<unknown>>();
  return {
    next: vi.fn(() => pending.promise),
    interrupt: vi.fn(async () => undefined),
    close: vi.fn(() => pending.resolve({ done: true, value: undefined })),
    return: vi.fn(async () => ({ done: true as const, value: undefined })),
    [Symbol.asyncIterator]() { return this; },
  };
}

const turn = (signal: AbortSignal) => claudeCode.run({ cwd: '.', prompt: 'hello', sessionId: null, env: {}, signal })[Symbol.asyncIterator]();
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

it('closes the query after completion and removes its stop listener', async () => {
  const q = query();
  q.next.mockResolvedValueOnce({ done: false, value: { type: 'result', subtype: 'success', is_error: false, session_id: 's' } });
  q.next.mockResolvedValueOnce({ done: true, value: undefined });
  queryMock.mockReturnValue(q);
  const controller = new AbortController();
  const iterator = turn(controller.signal);
  expect((await iterator.next()).done).toBe(false);
  expect((await iterator.next()).done).toBe(true);
  expect(q.close).toHaveBeenCalledOnce();
  expect(q.return).toHaveBeenCalledOnce();
  controller.abort();
  expect(q.interrupt).not.toHaveBeenCalled();
});

it('waits for query cleanup before a stopped turn finishes', async () => {
  const q = query();
  const cleaning = deferred<void>();
  const cleaned = deferred<void>();
  q.return.mockImplementation(async () => {
    cleaning.resolve();
    await cleaned.promise;
    return { done: true, value: undefined };
  });
  queryMock.mockReturnValue(q);
  const controller = new AbortController();
  let finished = false;
  const stopped = turn(controller.signal).next().then((value) => { finished = true; return value; });
  controller.abort();
  await cleaning.promise;
  expect(q.interrupt).toHaveBeenCalledOnce();
  expect(q.close).toHaveBeenCalledOnce();
  expect(finished).toBe(false);
  cleaned.resolve();
  expect((await stopped).done).toBe(true);
});

it('bounds the interruption grace period when Claude does not acknowledge it', async () => {
  vi.useFakeTimers();
  const q = query();
  q.interrupt.mockImplementation(() => new Promise(() => {}));
  queryMock.mockReturnValue(q);
  const controller = new AbortController();
  const stopped = turn(controller.signal).next();
  controller.abort();
  await vi.advanceTimersByTimeAsync(3000);
  expect((await stopped).done).toBe(true);
  expect(q.close).toHaveBeenCalledOnce();
});

it('cleans up a query that fails, and never starts an already aborted turn', async () => {
  const q = query();
  q.next.mockRejectedValueOnce(new Error('query failed'));
  queryMock.mockReturnValue(q);
  await expect(turn(new AbortController().signal).next()).rejects.toThrow('query failed');
  expect(q.close).toHaveBeenCalledOnce();
  const controller = new AbortController();
  controller.abort();
  expect((await turn(controller.signal).next()).done).toBe(true);
  expect(queryMock).toHaveBeenCalledOnce();
});

it('tells Claude that the chat renders inline media', async () => {
  const q = query();
  q.next.mockResolvedValueOnce({ done: true, value: undefined });
  queryMock.mockReturnValue(q);
  const iterator = turn(new AbortController().signal);
  await iterator.next();
  expect(queryMock.mock.calls[0]![0].options.systemPrompt).toMatchObject({ type: 'preset', preset: 'claude_code', append: expect.stringContaining('# Inline media') });
});
