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

it('streams steering into the same Claude query with immediate priority and closes the channel on result', async () => {
  const q = query(); queryMock.mockReturnValue(q);
  let send: ((text: string) => Promise<void>) | undefined;
  const iterator = claudeCode.run({ cwd: '.', prompt: 'start', sessionId: 's', env: {}, signal: new AbortController().signal,
    registerSteer: value => { send = value; } })[Symbol.asyncIterator]();
  const output = iterator.next();
  const input = queryMock.mock.calls[0]![0].prompt[Symbol.asyncIterator]();
  expect((await input.next()).value.message.content).toBe('start');
  const sending = send!('correction');
  expect((await input.next()).value).toMatchObject({ priority: 'now', message: { role: 'user', content: 'correction' } });
  await sending;
  q.close();
  await output;
  expect(send).toBeUndefined();
  expect((await input.next()).done).toBe(true);
});

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

it("points Claude at this turn's accio tools", async () => {
  const q = query();
  q.next.mockResolvedValue({ done: true, value: undefined });
  queryMock.mockReturnValue(q);
  const tools = { url: 'http://127.0.0.1:1/mcp', authorization: 'Bearer t' };
  await claudeCode.run({ cwd: '.', prompt: 'hi', sessionId: null, env: {}, tools, signal: new AbortController().signal })[Symbol.asyncIterator]().next();
  expect(queryMock.mock.calls[0]![0].options.mcpServers).toEqual({ accio: { type: 'http', url: tools.url, headers: { Authorization: 'Bearer t' } } });
  await turn(new AbortController().signal).next();
  expect(queryMock.mock.calls[1]![0].options.mcpServers).toBeUndefined();
  const remote = { type: 'http' as const, url: 'http://127.0.0.1:2/mcp', headers: { Authorization: 'Bearer remote' } };
  await claudeCode.run({ cwd: '.', prompt: 'hi', sessionId: null, env: {}, tools, mcps: { remote }, resourceInstructions: 'Enabled skill: browser', signal: new AbortController().signal })[Symbol.asyncIterator]().next();
  expect(queryMock.mock.calls[2]![0].options.mcpServers).toMatchObject({ accio: { url: tools.url }, remote });
  expect(queryMock.mock.calls[2]![0].options.systemPrompt.append).toContain('Enabled skill: browser');
});

it('removes switched-off built-in tools from the model by name', async () => {
  const q = query(); queryMock.mockReturnValue(q);
  const iterator = claudeCode.run({ cwd: '.', prompt: 'hi', sessionId: null, env: {}, signal: new AbortController().signal,
    toolsOff: [{ id: 'cron', name: 'Cron', description: '', tools: ['CronCreate', 'CronList'], default: 'off' }] })[Symbol.asyncIterator]();
  const output = iterator.next();
  expect(queryMock.mock.calls[0]![0].options.disallowedTools).toEqual(['CronCreate', 'CronList']);
  q.close(); await output;
});
