import { expect, it, vi } from 'vitest';
import type { DeliveryMode, DeliverySummary, ThreadDelivery, ThreadView } from '@accio/protocol';
import { startedThreadTools } from './startedThreads.js';

const context = { threadId: 'caller', signal: new AbortController().signal, progress: () => {} };
const started = { threadId: 'caller', machineId: 'here' };
const thread = (patch: Partial<ThreadView>) => ({ id: 'w1', title: 'Fix the window controls', status: 'idle', profileId: 'p1', snoozedUntil: null, settledAt: null,
  workspace: { path: '/w', branch: 'accio/w1' }, startedBy: started, ...patch }) as ThreadView;
const pr = { host: 'github.com', repository: 'o/r', number: 7, url: 'https://github.com/o/r/pull/7', state: 'open', headRevision: 'abc', baseBranch: 'main' } as const;
const delivery = (patch: Partial<ThreadDelivery>): ThreadDelivery => ({ mode: 'ship', policy: 'pull-request', status: 'queued', baseBranch: 'main', requestedAt: '', ...patch });
const available: DeliverySummary = { available: true, baseBranch: 'main', added: 3, removed: 1, modified: 0, files: 1 };

function setup(worker: ThreadView, { summary = available, after }: { summary?: DeliverySummary; after?: (mode: DeliveryMode) => Partial<ThreadView> } = {}) {
  const threads = [thread({ id: 'caller', title: 'Coordinate', startedBy: undefined, workspace: undefined }), worker,
    thread({ id: 'other', title: 'Someone else', startedBy: { threadId: 'elsewhere', machineId: 'here' } })];
  const deliver = vi.fn(async (id: string, mode: DeliveryMode) => ({ ...worker, ...after?.(mode) }));
  const settle = vi.fn(async () => ({ ...worker, settledAt: '2026-11-23T10:00:00Z' }));
  const [deliverTool, settleTool] = startedThreadTools({ here: 'here', threads: () => threads, summary: async () => summary, deliver, settle });
  return { deliverTool: deliverTool!, settleTool: settleTool!, deliver, settle };
}

it('starts delivery of an idle started thread in either mode, and says what happened', async () => {
  for (const mode of ['ship', 'review'] as const) {
    const { deliverTool, deliver } = setup(thread({}), { after: (m) => ({ delivery: delivery({ mode: m, status: 'running' }) }) });
    const reply = await deliverTool.call({ thread: 'w1', mode }, context);
    expect(deliver).toHaveBeenCalledWith('w1', mode);
    expect(reply).toContain(mode === 'ship' ? 'Ship started.' : 'Prepare for review started.');
    expect(reply).toContain('wait_for with thread_state "delivered"');
  }
});

it('queues delivery behind a running turn and names the PR once one exists', async () => {
  const { deliverTool } = setup(thread({ status: 'running' }), { after: () => ({ delivery: delivery({ pullRequest: pr }) }) });
  const reply = await deliverTool.call({ thread: 'w1', mode: 'ship' }, context);
  expect(reply).toContain("Ship is queued: it starts when the thread's running turn finishes.");
  expect(reply).toContain('Its PR: https://github.com/o/r/pull/7 (open).');
});

it('refuses a thread this thread did not start, without calling delivery', async () => {
  const { deliverTool, settleTool, deliver, settle } = setup(thread({}));
  await expect(deliverTool.call({ thread: 'other', mode: 'ship' }, context)).rejects.toThrow('was not started by this thread');
  await expect(settleTool.call({ thread: 'other' }, context)).rejects.toThrow('was not started by this thread');
  await expect(deliverTool.call({ thread: 'nope', mode: 'ship' }, context)).rejects.toThrow('No thread nope.');
  expect(deliver).not.toHaveBeenCalled();
  expect(settle).not.toHaveBeenCalled();
});

it('returns why Ship is unavailable, as the composer does', async () => {
  const cases: [ThreadView, DeliverySummary, string][] = [
    [thread({}), { ...available, available: false, reason: 'Add an origin remote before shipping.' }, 'Add an origin remote before shipping.'],
    [thread({ queuedMessages: [{ id: 'q', text: 'more' }] }), available, 'Send or remove queued messages first'],
    [thread({ delivery: delivery({ status: 'running' }) }), available, 'Delivery is already requested.'],
    [thread({ delivery: delivery({ status: 'delivered' }) }), available, 'It is already delivered to main.'],
    [thread({ delivery: delivery({ status: 'waiting', pullRequest: pr }) }), available, 'Its delivery is still under way with PR https://github.com/o/r/pull/7.'],
    [thread({}), { ...available, onBase: true }, 'Its commits are already on main'],
    [thread({ machine: { id: 'mac', name: 'MacGonagall', online: false } }), available, 'MacGonagall is offline'],
  ];
  for (const [worker, summary, reason] of cases) {
    const { deliverTool, deliver } = setup(worker, { summary });
    await expect(deliverTool.call({ thread: 'w1', mode: 'ship' }, context)).rejects.toThrow(reason);
    expect(deliver).not.toHaveBeenCalled();
  }
});

it('ships again after a blocker or new work', async () => {
  for (const worker of [thread({ delivery: delivery({ status: 'blocked', detail: 'Tests fail' }) }), thread({ workVersion: 2, delivery: delivery({ status: 'delivered', workVersion: 1 }) })]) {
    const { deliverTool, deliver } = setup(worker, { after: () => ({ delivery: delivery({ status: 'running' }) }) });
    await deliverTool.call({ thread: 'w1', mode: 'ship' }, context);
    expect(deliver).toHaveBeenCalledOnce();
  }
});

it('settles a started thread, on another machine too, and refuses one already settled', async () => {
  const { settleTool, settle } = setup(thread({ machine: { id: 'mac', name: 'MacGonagall', online: true } }));
  expect(await settleTool.call({ thread: 'w1' }, context)).toBe('Settled "Fix the window controls" (@fix-the-window-w1). Its worktree is released if it holds no work; otherwise it stays allocated.');
  expect(settle).toHaveBeenCalledWith('w1');
  const again = setup(thread({ settledAt: '2026-11-23T09:00:00Z' }));
  await expect(again.settleTool.call({ thread: 'w1' }, context)).rejects.toThrow('is already settled.');
  expect(again.settle).not.toHaveBeenCalled();
});

it('is offered only to a thread that has started threads', () => {
  const { deliverTool, settleTool } = setup(thread({}));
  for (const tool of [deliverTool, settleTool]) {
    expect(tool.available?.('caller', {})).toBe(true);
    expect(tool.available?.('w1', {})).toBe(false);
  }
});
