import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { ThreadView } from '@accio/protocol';
import { FakeHarness, replyWith } from '../testing/fakeHarness.js';
import { startTestApp, type TestClient } from '../testing/testApp.js';
import { git } from '../git.js';

// These tests spawn real Git and Node processes; allow for Windows CI contention.
vi.setConfig({ testTimeout: 30_000 });

let t: Awaited<ReturnType<typeof startTestApp>>;
afterEach(async () => { vi.restoreAllMocks(); await t?.stop(); });

const DELIVER = 'Deliver the current task';

/**
 * `check.cjs` is the project's test: it fails while `fail.txt` exists in the worktree,
 * or for the first `flaky` runs counted in a file outside it, and can wait on `hold.txt`.
 */
const CHECK = `const fs = require('fs'); const path = require('path');
const counter = process.argv[2];
const n = Number(fs.existsSync(counter) ? fs.readFileSync(counter, 'utf8') : '0') + 1;
fs.writeFileSync(counter, String(n));
fs.writeFileSync(counter + '.home', process.env.ACCIO_HOME || '');
const flaky = Number(process.argv[3] || 0);
if (n === 1 && process.argv[4]) require('child_process').execFileSync('git', ['-C', process.argv[4], 'push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
if (fs.existsSync('hold.txt')) setTimeout(() => {}, 60000);
else process.exit(fs.existsSync('fail.txt') || n <= flaky ? 1 : 0);
`;

async function setup(script: (run: Parameters<ConstructorParameters<typeof FakeHarness>[0] & {}>[0], n: number) => AsyncIterable<any> | Iterable<any>, flaky = 0) {
  const harness = Object.assign(new FakeHarness(script), {
    generateText: vi.fn(async ({ prompt }: { prompt: string }) => prompt.startsWith('Write the commit message')
      ? JSON.stringify({ commit: 'Add the feature', summary: 'The feature is here', test: ['Open it'] })
      : JSON.stringify({ title: 'Feature work' })),
  });
  t = await startTestApp({ harness });
  const c = await t.connect();
  await c.signedIn('Personal');
  const source = join(t.home, 'source');
  const origin = join(t.home, 'origin.git');
  await mkdir(source);
  await git(source, 'init', '--quiet', '-b', 'main');
  await git(source, 'config', 'user.name', 'Accio Test');
  await git(source, 'config', 'user.email', 'accio@example.test');
  await git(source, 'config', 'core.autocrlf', 'false');
  await writeFile(join(source, 'seed.txt'), 'base\n');
  await writeFile(join(source, 'check.cjs'), CHECK);
  await git(source, 'add', '.');
  await git(source, 'commit', '--quiet', '-m', 'base');
  await git(t.home, 'init', '--quiet', '--bare', '-b', 'main', origin);
  await git(source, 'remote', 'add', 'origin', origin);
  await git(source, 'push', '--quiet', '-u', 'origin', 'main');
  await git(source, 'remote', 'set-head', 'origin', '-a');
  const checkout = await c.call('checkouts.add', { path: source, profileId: 'personal' });
  const counter = join(t.home, 'test-runs');
  await c.call('projects.setDelivery', { projectId: checkout.projectId, deliveryPolicy: 'direct', previewCommand: '', testCommand: `node check.cjs "${counter}" ${flaky}` });
  const runs = async () => Number(await readFile(counter, 'utf8').catch(() => '0'));
  return { c, harness, origin, checkout, runs, counter };
}

const wait = (c: TestClient, id: string, predicate: (t: ThreadView) => boolean, timeout = 20_000) =>
  c.waitFor('threads.changed', ts => ts.some(t => t.id === id && predicate(t)), timeout);

const working = (file: string, content = 'feature\n') => async function* (run: { cwd: string; prompt: string }, n: number) {
  if (n === 1) await writeFile(join(run.cwd, file), content);
  yield* replyWith('done');
};

async function pushFromElsewhere(origin: string, file: string, content: string) {
  const writer = join(t.home, `writer-${Math.random().toString(36).slice(2)}`);
  await git(t.home, 'clone', '--quiet', origin, writer);
  await git(writer, 'config', 'user.name', 'Accio Test');
  await git(writer, 'config', 'user.email', 'accio@example.test');
  await writeFile(join(writer, file), content);
  await git(writer, 'add', '.');
  await git(writer, 'commit', '--quiet', '-m', `remote ${file}`);
  await git(writer, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main');
}

it('commits, rebases, tests and pushes without a model turn, then verifies', async () => {
  const { c, harness, origin, checkout, runs, counter } = await setup(working('feature.txt'));
  const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'build feature' });
  await wait(c, thread.id, x => x.status === 'idle');
  await pushFromElsewhere(origin, 'other.txt', 'someone else\n');
  await c.call('threads.deliver', { threadId: thread.id, mode: 'ship' });
  const done = await wait(c, thread.id, x => x.delivery?.status === 'delivered');
  expect(harness.runs).toHaveLength(1);
  expect(await runs()).toBe(1);
  expect(await readFile(`${counter}.home`, 'utf8')).toBe(join(t.home, 'ship-state', thread.id));
  expect(await git(origin, 'show', 'main:feature.txt')).toBe('feature');
  expect(await git(origin, 'show', 'main:other.txt')).toBe('someone else');
  expect(await git(origin, 'log', '-1', '--format=%s', 'main')).toBe('Add the feature');
  expect(done.find(x => x.id === thread.id)!.delivery).toMatchObject({ note: { summary: 'The feature is here', test: ['Open it'] } });
  const items = await c.call('threads.transcript', { threadId: thread.id });
  expect(items.some(i => i.kind === 'user' && i.delivery)).toBe(false);
  expect(items).toContainEqual(expect.objectContaining({ kind: 'shipped' }));
});

it('hands a conflict to the delivery turn with the files, from a clean worktree', async () => {
  let prompt = '';
  let status = '';
  const { c, harness, origin, checkout } = await setup(async function* (run, n) {
    if (n === 1) await writeFile(join(run.cwd, 'seed.txt'), 'thread edit\n');
    if (run.prompt.startsWith(DELIVER)) { prompt = run.prompt; status = await git(run.cwd, 'status', '--porcelain'); }
    yield* replyWith('done');
  });
  const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'edit seed' });
  await wait(c, thread.id, x => x.status === 'idle');
  await pushFromElsewhere(origin, 'seed.txt', 'remote edit\n');
  await c.call('threads.deliver', { threadId: thread.id, mode: 'ship' });
  await wait(c, thread.id, x => x.status === 'idle' && harness.runs.length === 2 && x.delivery?.status !== 'running');
  expect(prompt).toContain('Latest delivery update: Rebasing onto main conflicted in seed.txt');
  expect(status).toBe('');
  expect(await git(thread.workspace!.path, 'log', '-1', '--format=%s')).toBe('Add the feature');
});

it('reruns a failing test once and publishes when it passes', async () => {
  const { c, harness, origin, checkout, runs } = await setup(working('feature.txt'), 1);
  const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'build feature' });
  await wait(c, thread.id, x => x.status === 'idle');
  await c.call('threads.deliver', { threadId: thread.id, mode: 'ship' });
  await wait(c, thread.id, x => x.delivery?.status === 'delivered');
  expect(await runs()).toBe(2);
  expect(harness.runs).toHaveLength(1);
  expect(await git(origin, 'show', 'main:feature.txt')).toBe('feature');
});

it('hands over with the output after the test fails twice, without pushing', async () => {
  let prompt = '';
  const { c, harness, origin, checkout, runs } = await setup(async function* (run, n) {
    if (n === 1) await writeFile(join(run.cwd, 'fail.txt'), 'broken\n');
    if (run.prompt.startsWith(DELIVER)) prompt = run.prompt;
    yield* replyWith('done');
  });
  const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'break it' });
  await wait(c, thread.id, x => x.status === 'idle');
  const before = await git(origin, 'rev-parse', 'main');
  await c.call('threads.deliver', { threadId: thread.id, mode: 'ship' });
  await wait(c, thread.id, x => x.status === 'idle' && harness.runs.length === 2 && x.delivery?.status !== 'running');
  expect(await runs()).toBe(2);
  expect(prompt).toMatch(/failed twice on the rebased revision/);
  expect(await git(origin, 'rev-parse', 'main')).toBe(before);
});

it('keeps the agent path when the project has no test command', async () => {
  const { c, harness, checkout, runs } = await setup(async function* (run, n) {
    if (n === 1) await writeFile(join(run.cwd, 'feature.txt'), 'feature\n');
    yield* replyWith('done');
  });
  await c.call('projects.setDelivery', { projectId: checkout.projectId, deliveryPolicy: 'direct', previewCommand: '', testCommand: '' });
  const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'build feature' });
  await wait(c, thread.id, x => x.status === 'idle');
  await c.call('threads.deliver', { threadId: thread.id, mode: 'ship' });
  await wait(c, thread.id, x => x.status === 'idle' && harness.runs.length === 2 && x.delivery?.status !== 'running');
  expect(harness.runs[1]!.prompt).toMatch(new RegExp(`^${DELIVER}`));
  expect(await runs()).toBe(0);
});

it('cancels a running test, publishes nothing and clears the request', async () => {
  const { c, harness, origin, checkout, runs } = await setup(working('hold.txt', 'wait\n'));
  const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'slow tests' });
  await wait(c, thread.id, x => x.status === 'idle');
  const before = await git(origin, 'rev-parse', 'main');
  await c.call('threads.deliver', { threadId: thread.id, mode: 'ship' });
  await wait(c, thread.id, x => x.delivery?.step?.name === 'verify');
  await expect.poll(runs).toBe(1);
  await expect(c.call('threads.send', { threadId: thread.id, text: 'more' })).rejects.toThrow(/delivery/);
  await c.call('threads.cancelDelivery', { threadId: thread.id });
  await wait(c, thread.id, x => !x.delivery);
  expect(harness.runs).toHaveLength(1);
  expect(await git(origin, 'rev-parse', 'main')).toBe(before);
  await expect(stat(join(thread.workspace!.path, '.git'))).resolves.toBeDefined();
});

it('runs a scripted ship cut off by a restart again once accio is back', async () => {
  const { c, origin, checkout, runs } = await setup(working('hold.txt', 'wait\n'));
  const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'slow tests' });
  await wait(c, thread.id, x => x.status === 'idle');
  await c.call('threads.deliver', { threadId: thread.id, mode: 'ship' });
  await wait(c, thread.id, x => x.delivery?.step?.name === 'verify');
  await expect.poll(runs).toBe(1);
  await t.stop({ keepHome: true });
  const stored = JSON.parse(await readFile(join(t.home, 'threads.json'), 'utf8'));
  expect(stored[0].delivery).toMatchObject({ status: 'queued' });
  expect(stored[0].delivery.startedAt).toBeUndefined();

  await rm(join(thread.workspace!.path, 'hold.txt'));
  const harness = new FakeHarness();
  t = await startTestApp({ harness }, t.home);
  const next = await t.connect();
  await t.app.threads.continueAfterRestart();
  await expect.poll(async () => (await next.call('threads.list', {}))[0]?.delivery?.status, { timeout: 20_000 }).toBe('delivered');
  expect(harness.runs).toHaveLength(0);
  expect(await runs()).toBe(2);
  await expect(git(origin, 'show', 'main:hold.txt')).rejects.toThrow();
});

it('rebases and tests again when the target moves before the push', async () => {
  const { c, harness, origin, checkout, runs, counter } = await setup(working('feature.txt'));
  const writer = join(t.home, 'racer');
  await git(t.home, 'clone', '--quiet', origin, writer);
  await git(writer, 'config', 'user.name', 'Accio Test');
  await git(writer, 'config', 'user.email', 'accio@example.test');
  await writeFile(join(writer, 'other.txt'), 'raced\n');
  await git(writer, 'add', '.');
  await git(writer, 'commit', '--quiet', '-m', 'race');
  // The first test run pushes from another clone, so the thread's push is rejected once.
  await c.call('projects.setDelivery', { projectId: checkout.projectId, deliveryPolicy: 'direct', previewCommand: '', testCommand: `node check.cjs "${counter}" 0 "${writer}"` });
  const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'build feature' });
  await wait(c, thread.id, x => x.status === 'idle');
  await c.call('threads.deliver', { threadId: thread.id, mode: 'ship' });
  await wait(c, thread.id, x => x.delivery?.status === 'delivered');
  expect(await runs()).toBe(2);
  expect(harness.runs).toHaveLength(1);
  expect(await git(origin, 'show', 'main:other.txt')).toBe('raced');
  expect(await git(origin, 'show', 'main:feature.txt')).toBe('feature');
});
