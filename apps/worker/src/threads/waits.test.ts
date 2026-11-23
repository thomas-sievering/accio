import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThreadView, ThreadWait } from '@accio/protocol';
import { FakeHarness, gate, replyWith } from '../testing/fakeHarness.js';
import { callAccioTools as mcp, startTestApp } from '../testing/testApp.js';
import type { GhPullRequest } from './ghReplies.js';
import type { ThreadState } from './state.js';
import type { Thread } from './thread.js';
import { pullRequestReached, threadReached, Waits, wakeMessage, type WaitHost } from './waits.js';

const view = (patch: Partial<ThreadView>) => ({ id: 't', title: 'Fix it', status: 'idle', profileId: 'p', ...patch }) as ThreadView;
const pr = (patch: Partial<GhPullRequest>) => ({ url: 'https://github.com/o/r/pull/7', state: 'OPEN', headRefOid: 'abc', baseRefName: 'main', statusCheckRollup: [], ...patch }) as GhPullRequest;

describe('Wait conditions', () => {
  it('meets "stopped" only once a started thread has nothing left to run', () => {
    expect(threadReached(view({ status: 'running' }), 'stopped')).toBeUndefined();
    expect(threadReached(view({ queuedMessages: [{ id: 'q', text: 'more' }] }), 'stopped')).toBeUndefined();
    expect(threadReached(view({ goal: { objective: 'x', status: 'active', turns: 1, setAt: '' } }), 'stopped')).toBeUndefined();
    expect(threadReached(undefined, 'stopped')).toBeUndefined();
    expect(threadReached(view({}), 'stopped')).toBe('stopped and is idle');
    expect(threadReached(view({ status: 'failed' }), 'pr_open')).toBe('failed');
  });

  it('meets "pr_open" and "delivered" from the started thread\'s delivery', () => {
    const delivery = { mode: 'ship', policy: 'pull-request', status: 'waiting', baseBranch: 'main', requestedAt: '',
      pullRequest: { host: 'github.com', repository: 'o/r', number: 7, url: 'https://github.com/o/r/pull/7', state: 'open', headRevision: 'abc', baseBranch: 'main' } } as const;
    expect(threadReached(view({ status: 'running' }), 'pr_open')).toBeUndefined();
    expect(threadReached(view({ status: 'running', delivery }), 'pr_open')).toBe('opened PR https://github.com/o/r/pull/7 (open)');
    expect(threadReached(view({ delivery }), 'delivered')).toBeUndefined();
    expect(threadReached(view({ delivery: { ...delivery, status: 'delivered' } }), 'delivered')).toBe('delivered to main, PR https://github.com/o/r/pull/7 open');
  });

  it('meets "delivered" once a delivery stops on a person, not while it is under way', () => {
    const pullRequest = { host: 'github.com', repository: 'o/r', number: 7, url: 'https://github.com/o/r/pull/7', state: 'open', headRevision: 'abc', baseBranch: 'main' } as const;
    const delivery = { mode: 'review', policy: 'pull-request', status: 'waiting', baseBranch: 'main', requestedAt: '', pullRequest } as const;
    expect(threadReached(view({ delivery: { ...delivery, waitingOn: 'checks' } }), 'delivered')).toBeUndefined();
    expect(threadReached(view({ delivery: { ...delivery, status: 'ready' } }), 'delivered')).toBe('prepared for review, PR https://github.com/o/r/pull/7 open, ready to merge by hand');
    expect(threadReached(view({ delivery: { ...delivery, mode: 'ship', waitingOn: 'review' } }), 'delivered')).toBe('delivery waits on review, PR https://github.com/o/r/pull/7 open');
    expect(threadReached(view({ delivery: { ...delivery, mode: 'ship', pullRequest: { ...pullRequest, state: 'closed' } } }), 'delivered')).toBe('PR https://github.com/o/r/pull/7 was closed without merging');
    expect(threadReached(view({ delivery: { ...delivery, status: 'ready', observationError: 'gh failed' } }), 'delivered')).toBeUndefined();
    expect(threadReached(view({ status: 'running', delivery: { ...delivery, status: 'ready' } }), 'delivered')).toBeUndefined();
    // A Ship queued behind a turn that failed waits for someone to resume it.
    expect(threadReached(view({ status: 'failed', delivery: { ...delivery, status: 'queued' } }), 'delivered')).toBe('failed, PR https://github.com/o/r/pull/7 open');
  });

  it('meets "checks_done" when every check finished, and "merged" on merge or close', () => {
    const running = { name: 'test', status: 'IN_PROGRESS' };
    expect(pullRequestReached(pr({ statusCheckRollup: [running] }), 'checks_done', 0)).toBeUndefined();
    expect(pullRequestReached(pr({ statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }, { context: 'ci/lint', state: 'SUCCESS' }] }), 'checks_done', 0)).toBe('checks finished, all 2 passed');
    expect(pullRequestReached(pr({ statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }] }), 'checks_done', 0)).toBe('checks finished, 1 failed: test');
    expect(pullRequestReached(pr({}), 'checks_done', 60_000)).toBeUndefined();
    expect(pullRequestReached(pr({}), 'checks_done', 15 * 60_000)).toBe('has no checks after 15 minutes');
    expect(pullRequestReached(pr({}), 'merged', 0)).toBeUndefined();
    expect(pullRequestReached(pr({ state: 'MERGED' }), 'merged', 0)).toBe('was merged');
    expect(pullRequestReached(pr({ state: 'CLOSED' }), 'merged', 0)).toBe('was closed without merging');
  });

  it('wakes with what was met, what was not, and the note', () => {
    const wait: ThreadWait = { id: 'w', setAt: '', wakeWhen: 'any', note: 'Review both PRs', conditions: [
      { kind: 'thread', threadId: '3f2a9c00', title: 'Fix login', until: 'stopped', metAt: 'now', detail: 'stopped and is idle' },
      { kind: 'pullRequest', ref: '12', until: 'merged' },
    ] };
    expect(wakeMessage(wait)).toBe([
      'Your Wait is met, so accio started this turn.',
      '- Waited for thread "Fix login" (@fix-login-3f2a9c) to stop: stopped and is idle',
      'Not met yet:',
      '- PR 12 to merge',
      'Your note: Review both PRs',
      'Call wait_for again to keep waiting.',
    ].join('\n'));
  });
});

/** A Waits over an in-memory thread list, for timers and pull requests. */
function memoryWaits(host: Partial<WaitHost> = {}) {
  const thread = { id: 'me', title: 'Coordinate', status: 'idle', profileId: 'p', checkoutId: 'co' } as Thread;
  const state = {
    list: [thread],
    get: (id: string) => state.list.find(t => t.id === id),
    require: (id: string) => state.list.find(t => t.id === id)!,
    update: async (id: string, fn: (t: Thread) => Thread) => { state.list = state.list.map(t => t.id === id ? fn(t) : t); return state.require(id); },
  };
  const wake = vi.fn(async () => {});
  const waits = new Waits(state as unknown as ThreadState, { threads: () => state.list, wake, pullRequest: async () => pr({}), command: async () => ({ cwd: process.cwd(), env: {} }), ...host });
  return { waits, state, wake };
}

describe('Waits', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('wakes the thread once the time comes, and keeps the Wait across a restart', async () => {
    vi.useFakeTimers();
    const { waits, state, wake } = memoryWaits();
    await waits.resume();
    expect(await waits.set('me', { after_minutes: 30, note: 'Check the deploy' })).toContain('End your turn now.');
    expect(state.get('me')!.wait).toMatchObject({ wakeWhen: 'any', note: 'Check the deploy', conditions: [{ kind: 'after' }] });
    waits.close();

    // A new process picks the stored Wait up.
    const restarted = new Waits(state as unknown as ThreadState, { threads: () => state.list, wake, pullRequest: async () => pr({}), command: async () => ({ cwd: '', env: {} }) });
    await restarted.resume();
    await vi.advanceTimersByTimeAsync(29 * 60_000);
    expect(wake).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(wake).toHaveBeenCalledOnce();
    expect(wake.mock.calls[0]).toEqual(['me', expect.stringContaining('Your note: Check the deploy')]);
    expect(state.get('me')!.wait).toBeUndefined();
  });

  it('reads pull requests until their checks finish', async () => {
    vi.useFakeTimers();
    const replies = [pr({ statusCheckRollup: [{ name: 'test', status: 'IN_PROGRESS' }] }), pr({ statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }] })];
    const pullRequest = vi.fn(async () => replies.shift()!);
    const { waits, wake } = memoryWaits({ pullRequest });
    await waits.resume();
    await waits.set('me', { pull_requests: ['#7'], note: 'Merge it' });
    await vi.advanceTimersByTimeAsync(0);
    expect(pullRequest).toHaveBeenCalledTimes(1);
    expect(wake).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(pullRequest).toHaveBeenCalledTimes(2);
    expect(wake.mock.calls[0]![1]).toContain('PR 7 to finish its checks: https://github.com/o/r/pull/7 checks finished, all 1 passed');
    waits.close();
  });

  it('waits for all when asked, and says when it is already met', async () => {
    const { waits, state, wake } = memoryWaits();
    state.list.push({ id: 'other', title: 'Build', status: 'idle', profileId: 'p' } as Thread);
    await waits.resume();
    expect(await waits.set('me', { threads: ['other'], note: 'x' })).toContain('Already met, so no Wait was set');
    expect(state.get('me')!.wait).toBeUndefined();
    await waits.set('me', { threads: ['other'], after_minutes: 5, wake_when: 'all', note: 'x' });
    expect(state.get('me')!.wait!.conditions.map(c => !!c.metAt)).toEqual([true, false]);
    expect(wake).not.toHaveBeenCalled();
    await expect(waits.set('me', { threads: ['me'], note: 'x' })).rejects.toThrow('cannot wait for itself');
    await expect(waits.set('me', { note: 'x' })).rejects.toThrow('Give at least one thing to wait for');
    waits.close();
  });
});

describe('wait_for', () => {
  let app: Awaited<ReturnType<typeof startTestApp>> | undefined;
  afterEach(async () => { await app?.stop(); app = undefined; });

  it('wakes the starting thread when the thread it started stops, pausing its goal meanwhile', async () => {
    const child = gate();
    const answers: string[] = [];
    const harness = new FakeHarness(async function* (run, n) {
      if (n === 1) {
        answers.push((await mcp(run, 'tools/call', { name: 'start_thread', arguments: { message: 'Build the feature' } })).content[0].text);
        answers.push((await mcp(run, 'tools/call', { name: 'wait_for', arguments: { started_threads: true, note: 'Review what it did' } })).content[0].text);
      }
      if (run.prompt === 'Build the feature') await child.opened;
      yield* replyWith(`turn ${n}`);
    });
    app = await startTestApp({ harness });
    const c = await app.signedIn('Personal');
    const coordinator = await c.call('threads.start', { profileId: 'personal', text: 'Coordinate' });
    await expect.poll(async () => (await c.call('threads.list', {})).find(t => t.id === coordinator.id)?.wait?.note).toBe('Review what it did');
    await expect.poll(async () => (await c.call('threads.list', {})).find(t => t.id === coordinator.id)?.status).toBe('idle');
    const started = (await c.call('threads.list', {})).find(t => t.id !== coordinator.id)!;
    expect(started.startedBy).toEqual({ threadId: coordinator.id, machineId: (await c.thisMachine()).id });
    expect(answers[1]).toContain('to stop');
    expect(harness.runs).toHaveLength(2);

    child.release();
    await expect.poll(() => harness.runs.length).toBe(3);
    await expect.poll(async () => (await c.call('threads.list', {})).find(t => t.id === coordinator.id)?.status).toBe('idle');
    expect(harness.runs[2]!.prompt).toContain(`- Waited for thread "${started.title}"`);
    expect(harness.runs[2]!.prompt).toContain('Your note: Review what it did');
    expect((await c.call('threads.list', {})).find(t => t.id === coordinator.id)!.wait).toBeUndefined();
    const wake = (await c.call('threads.transcript', { threadId: coordinator.id })).findLast(i => i.kind === 'user');
    expect(wake).toMatchObject({ kind: 'user', wake: true });
  });

  it('runs a command and wakes when it exits; Cancel stops one without a turn', async () => {
    const harness = new FakeHarness(async function* (run, n) {
      if (n === 1) await mcp(run, 'tools/call', { name: 'wait_for', arguments: { command: 'node -e "console.log(\'built\'); process.exit(3)"', note: 'Fix the build' } });
      if (n === 3) await mcp(run, 'tools/call', { name: 'wait_for', arguments: { command: 'node -e "setTimeout(() => {}, 60000)"', note: 'never' } });
      yield* replyWith(`turn ${n}`);
    });
    app = await startTestApp({ harness });
    const c = await app.signedIn('Personal');
    const thread = await c.call('threads.start', { profileId: 'personal', text: 'Build it' });
    await expect.poll(() => harness.runs.length, { timeout: 15_000 }).toBe(2);
    expect(harness.runs[1]!.prompt).toContain('command `node -e "console.log(\'built\'); process.exit(3)"` to exit: exited with code 3. Last output:\nbuilt');
    await expect.poll(async () => (await c.call('threads.list', {}))[0]!.status).toBe('idle');

    await c.call('threads.send', { threadId: thread.id, text: 'Again' });
    await expect.poll(async () => (await c.call('threads.list', {}))[0]!.wait?.note).toBe('never');
    await expect.poll(async () => (await c.call('threads.list', {}))[0]!.status).toBe('idle');
    expect((await c.call('threads.cancelWait', { threadId: thread.id })).wait).toBeUndefined();
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(harness.runs).toHaveLength(3);
  });
});
