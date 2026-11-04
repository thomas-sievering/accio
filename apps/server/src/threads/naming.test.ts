import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { Harness } from './harness.js';
import { FakeHarness } from '../testing/fakeHarness.js';
import { startTestApp } from '../testing/testApp.js';
import { namingContext, namingModel } from './naming.js';

let stop: (() => Promise<void>) | undefined;
afterEach(async () => { await stop?.(); stop = undefined; });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function setup(generate: NonNullable<Harness['generateText']>) {
  const harness = Object.assign(new FakeHarness(), { generateText: vi.fn(generate) });
  const app = await startTestApp({ harness });
  stop = app.stop;
  const c = await app.connect();
  await c.signedIn('Personal');
  return { ...app, c, harness };
}
const named = (title: string, needsRefinement = false) => JSON.stringify({ title, needsRefinement });

it('names asynchronously with a small model, outside the coding workspace, without adding a turn', async () => {
  const pending = deferred<string>();
  const { c, harness, home } = await setup(() => pending.promise);
  const thread = await c.call('threads.start', { profileId: 'personal', text: 'Please fix login redirects after signing in' });
  expect(thread.title).toBe('Please fix login redirects after signing in');
  await expect.poll(() => harness.generateText.mock.calls.length).toBe(1);
  expect(harness.generateText.mock.calls[0]![0]).toMatchObject({ model: 'haiku', cwd: join(home, 'naming') });
  pending.resolve(named('Fix login redirects'));
  await c.waitFor('threads.changed', list => list.some(t => t.id === thread.id && t.title === 'Fix login redirects'));
  expect(harness.runs).toHaveLength(1);
  const items = await c.call('threads.transcript', { threadId: thread.id });
  expect(items.filter(item => item.kind === 'user')).toHaveLength(1);
  const stored = JSON.parse(await readFile(join(home, 'threads.json'), 'utf8'));
  expect(stored.find((t: any) => t.id === thread.id).title).toBe('Fix login redirects');
});

it('protects a manual rename from a late automatic result and keeps it through follow-ups', async () => {
  const pending = deferred<string>();
  const { c, harness } = await setup(() => pending.promise);
  const thread = await c.call('threads.start', { profileId: 'personal', text: 'Fix login' });
  await expect.poll(() => harness.generateText.mock.calls.length).toBe(1);
  await c.call('threads.rename', { threadId: thread.id, title: 'New thread' });
  pending.resolve(named('Automatic title', true));
  await c.waitFor('threads.changed', list => list.some(t => t.id === thread.id && t.status === 'idle'));
  await c.call('threads.send', { threadId: thread.id, text: 'Continue with tests' });
  await expect.poll(async () => (await c.call('threads.list', {}))[0]?.status).toBe('idle');
  expect((await c.call('threads.list', {}))[0]?.title).toBe('New thread');
  expect(harness.generateText).toHaveBeenCalledTimes(1);
});

it('refines an ambiguous first request once using discovered subject, then stays stable', async () => {
  const { c, harness } = await setup(async ({ prompt }) => prompt.includes('Recent conversation:') ? named('Fix login redirect loop') : named('Investigate linked issue', true));
  const thread = await c.call('threads.start', { profileId: 'personal', text: 'Fix this https://example.com/issue' });
  await c.waitFor('threads.changed', list => list.some(t => t.id === thread.id && t.title === 'Fix login redirect loop'));
  expect(harness.generateText).toHaveBeenCalledTimes(2);
  await c.call('threads.send', { threadId: thread.id, text: 'Run tests and merge' });
  await expect.poll(async () => (await c.call('threads.list', {}))[0]?.status).toBe('idle');
  expect(harness.generateText).toHaveBeenCalledTimes(2);
});

it('previews unsaved instructions without changing the title and regenerates on explicit request', async () => {
  const { c, harness } = await setup(async ({ prompt }) => named(prompt.includes('Use German') ? 'Anmeldung reparieren' : 'Login redirects'));
  await c.call('threadNaming.save', { automatic: false, model: null, instructions: '' });
  const thread = await c.call('threads.start', { profileId: 'personal', text: 'Fix login' });
  await c.call('threads.rename', { threadId: thread.id, title: 'Handwritten' });
  expect(harness.generateText).not.toHaveBeenCalled();
  expect(await c.call('threads.previewTitle', { threadId: thread.id, model: null, instructions: 'Use German' })).toEqual({ title: 'Anmeldung reparieren' });
  expect((await c.call('threads.list', {}))[0]?.title).toBe('Handwritten');
  expect(await c.call('threadNaming.get', {})).toMatchObject({ instructions: '', automatic: false });
  expect(await c.call('threads.regenerateTitle', { threadId: thread.id })).toMatchObject({ title: 'Login redirects' });
});

it('keeps fallback titles on provider errors and reports errors for explicit regeneration', async () => {
  const { c, harness } = await setup(async () => { throw new Error('Provider unavailable'); });
  const thread = await c.call('threads.start', { profileId: 'personal', text: 'Fix login' });
  await expect.poll(() => harness.generateText.mock.calls.length).toBe(1);
  await c.waitFor('threads.changed', list => list.some(t => t.id === thread.id && t.status === 'idle'));
  expect((await c.call('threads.list', {}))[0]?.title).toBe('Fix login');
  await expect(c.call('threads.regenerateTitle', { threadId: thread.id })).rejects.toThrow('Provider unavailable');
  expect((await c.call('threads.list', {}))[0]?.title).toBe('Fix login');
});

it('aborts outstanding naming work during shutdown and retains the fallback on disk', async () => {
  let aborted = false;
  const t = await setup(({ signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
    aborted = true; reject(new Error('Stopped'));
  }, { once: true })));
  const thread = await t.c.call('threads.start', { profileId: 'personal', text: 'Fix login' });
  await expect.poll(() => t.harness.generateText.mock.calls.length).toBe(1);
  await t.stop({ keepHome: true });
  expect(aborted).toBe(true);
  const stored = JSON.parse(await readFile(join(t.home, 'threads.json'), 'utf8'));
  expect(stored.find((item: any) => item.id === thread.id).title).toBe('Fix login');
});

it('discards stale regenerations and results for deleted threads', async () => {
  const first = deferred<string>(); const second = deferred<string>();
  const { c, harness } = await setup(() => first.promise);
  await c.call('threadNaming.save', { automatic: false, model: null, instructions: '' });
  const thread = await c.call('threads.start', { profileId: 'personal', text: 'Fix login' });
  const older = c.call('threads.regenerateTitle', { threadId: thread.id });
  await expect.poll(() => harness.generateText.mock.calls.length).toBe(1);
  harness.generateText.mockImplementationOnce(() => second.promise);
  const newer = c.call('threads.regenerateTitle', { threadId: thread.id });
  await expect.poll(() => harness.generateText.mock.calls.length).toBe(2);
  second.resolve(named('Latest title')); await newer;
  first.resolve(named('Stale title')); await older;
  expect((await c.call('threads.list', {}))[0]?.title).toBe('Latest title');
  const deleted = deferred<string>(); harness.generateText.mockImplementationOnce(() => deleted.promise);
  const late = c.call('threads.regenerateTitle', { threadId: thread.id }).catch(() => undefined);
  await expect.poll(() => harness.generateText.mock.calls.length).toBe(3);
  await c.call('threads.delete', { threadId: thread.id });
  deleted.resolve(named('Deleted title')); await late;
  expect(await c.call('threads.list', {})).toEqual([]);
});

it('does not fall back to an expensive model or include tools, secret requests and delivery chatter', () => {
  const base = { providerId: 'openai' as const, harnessId: 'codex', harnessName: 'Codex', providerName: 'OpenAI', efforts: [{ id: 'low' }], description: '' };
  expect(namingModel([{ ...base, id: 'large', name: 'Large' }], 'codex')).toBeUndefined();
  expect(namingModel([{ ...base, id: 'small-mini', name: 'Mini' }], 'codex')).toEqual({ harnessId: 'codex', modelId: 'small-mini', effort: 'low' });
  expect(namingModel([{ ...base, id: 'small-mini', name: 'Mini', limited: { label: 'Limit', resetsAt: null } }], 'codex')).toBeUndefined();
  const context = namingContext([
    { kind: 'user', id: '1', turnId: '1', text: 'Fix login', at: '' },
    { kind: 'tool', id: '2', turnId: '1', name: 'Read', summary: 'PRIVATE_TOOL_OUTPUT', output: 'PRIVATE_TOOL_OUTPUT', status: 'done' },
    { kind: 'user', id: '3', turnId: '2', text: 'Ship to main', at: '', delivery: 'ship' },
    { kind: 'assistant', id: '4', turnId: '1', text: 'The redirect loops.' },
  ], false);
  expect(context).toContain('Fix login'); expect(context).toContain('redirect loops');
  expect(context).not.toContain('PRIVATE_TOOL_OUTPUT'); expect(context).not.toContain('Ship to main');
});
