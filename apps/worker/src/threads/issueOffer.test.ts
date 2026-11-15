import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { implementMessage, threadHandle, type IssueList, type IssueView, type TranscriptItem } from '@accio/protocol';
import { runCommand } from '../resources/process.js';
import { FakeHarness, SESSION, replyWith } from '../testing/fakeHarness.js';
import { startTestApp, type TestClient } from '../testing/testApp.js';
import type { HarnessMessage } from './harness.js';
import { findIssue, implementable, offeredIssues } from './issueOffer.js';

const issue = (ref: string, more: Partial<IssueView> = {}): IssueView => ({ ref, label: ref, title: `Title ${ref}`, blockedBy: [], labels: [], assignees: [], ...more });
const github: IssueList = { tracker: { kind: 'github', repository: 'me/app' }, issues: [
  issue('#207', { url: 'https://github.com/me/app/issues/207' }), issue('#208', { blockedBy: ['#207'] }),
] };

describe('matching offered issues', () => {
  it('finds an issue by its reference, its number, its URL or a local path with backslashes', () => {
    expect(findIssue(github.issues, '#207')?.ref).toBe('#207');
    expect(findIssue(github.issues, '208')?.ref).toBe('#208');
    expect(findIssue(github.issues, 'https://github.com/me/app/issues/207')?.ref).toBe('#207');
    const local = [issue('.scratch/relay/issues/01-retry.md', { label: '01' })];
    expect(findIssue(local, '.scratch\\relay\\issues\\01-retry.md')?.label).toBe('01');
    expect(findIssue(local, './.scratch/relay/issues/01-retry.md')?.label).toBe('01');
    expect(findIssue(github.issues, '#20')).toBeUndefined();
  });

  it('keeps each issue once, as the tracker names it, and refuses ones it does not list', () => {
    expect(offeredIssues(github, ['207', '#208', '#207'])).toEqual([
      { ref: '#207', label: '#207', title: 'Title #207', url: 'https://github.com/me/app/issues/207' },
      { ref: '#208', label: '#208', title: 'Title #208' },
    ]);
    expect(() => offeredIssues(github, ['#207', '#999'])).toThrow('Not an open issue in me/app: #999.');
    expect(() => offeredIssues({ issues: [] }, ['#1'])).toThrow(/no issue tracker/);
    expect(() => offeredIssues({ tracker: github.tracker, issues: [], unavailable: 'gh is signed out' }, ['#1'])).toThrow('gh is signed out');
  });

  it('starts only issues that are open, unblocked and unclaimed', () => {
    expect(implementable(issue('#1'))).toEqual({ ok: true });
    expect(implementable(undefined)).toEqual({ ok: false, reason: 'closed' });
    expect(implementable(issue('#2', { blockedBy: ['#1', '#3'] }))).toEqual({ ok: false, reason: 'waits on #1, #3' });
    expect(implementable(issue('#3', { assignees: ['me'] }))).toEqual({ ok: false, reason: 'claimed' });
    expect(implementable(issue('#4', { status: 'claimed' }))).toEqual({ ok: false, reason: 'claimed' });
  });
});

/** Claude streams the call, then the SDK reports the tool's result. */
function* offer(refs: string[], id = 'offer-1'): Iterable<HarnessMessage> {
  const name = 'mcp__accio__offer_issues';
  yield { type: 'system', subtype: 'init', session_id: SESSION };
  yield { type: 'assistant', parent_tool_use_id: null, session_id: SESSION, message: { id: 'm1', content: [{ type: 'tool_use', id, name, input: { refs } }] } };
  yield { type: 'user', parent_tool_use_id: null, session_id: SESSION, message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: 'shown' }] }] } };
  yield { type: 'result', subtype: 'success', is_error: false, session_id: SESSION };
}

const ghIssues = (assigned: string[]) => JSON.stringify([
  { number: 207, title: 'Issues fold', url: 'https://github.com/me/app/issues/207', labels: [{ name: 'ready-for-agent' }], assignees: assigned.includes('207') ? [{ login: 'me' }] : [], blockedBy: { nodes: [] }, parent: null },
  { number: 208, title: 'Read an issue', labels: [{ name: 'ready-for-agent' }], assignees: [], blockedBy: { nodes: [{ number: 207, state: 'OPEN' }] }, parent: null },
]);

describe('an issue offer in a thread', () => {
  let stop: (() => Promise<void>) | undefined;
  afterEach(async () => { await stop?.(); stop = undefined; });

  async function offered(refs: string[]) {
    const assigned: string[] = [];
    const harness = new FakeHarness(async function* (_run, n) {
      if (n === 1) yield* offer(refs);
      else yield* replyWith('On it');
    });
    const t = await startTestApp({ harness, github: async (args) => {
      if (args[0] === 'issue' && args[1] === 'list') return ghIssues(assigned);
      if (args[0] === 'issue' && args[1] === 'edit') { assigned.push(args[2]!); return ''; }
      throw new Error('unexpected gh call');
    } });
    stop = t.stop;
    const c = await t.connect(); await c.signedIn('Personal');
    const folder = join(t.home, 'project');
    await mkdir(dirname(join(folder, 'README.md')), { recursive: true }); await writeFile(join(folder, 'README.md'), '# App\n');
    await runCommand('git', ['init', '--quiet', '-b', 'main'], { cwd: folder });
    await runCommand('git', ['remote', 'add', 'origin', 'https://github.com/me/app.git'], { cwd: folder });
    await runCommand('git', ['add', '.'], { cwd: folder });
    await runCommand('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--quiet', '-m', 'initial'], { cwd: folder });
    const bare = join(t.home, 'origin.git');
    await runCommand('git', ['clone', '--quiet', '--bare', folder, bare], { cwd: t.home });
    await runCommand('git', ['config', `url.${bare}.insteadOf`, 'https://github.com/me/app.git'], { cwd: folder });
    await runCommand('git', ['fetch', '--quiet', 'origin'], { cwd: folder });
    const checkout = await c.call('checkouts.add', { path: folder, profileId: 'personal' });
    const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'Publish the tickets' });
    await settled(c, thread.id);
    const items = await c.call('threads.transcript', { threadId: thread.id });
    return { c, thread, items, harness, assigned };
  }

  const settled = (c: TestClient, threadId: string) =>
    c.waitFor('threads.changed', (list) => list.some((x) => x.id === threadId && x.status === 'idle'));

  it('shows the offer instead of its tool row, and a refused call as a tool row', async () => {
    const { items } = await offered(['207', '#208']);
    expect(items.filter((item) => item.kind === 'tool')).toEqual([]);
    expect(items.find((item) => item.kind === 'issueOffer')).toEqual({ kind: 'issueOffer', id: 'offer-1', turnId: expect.any(String), issues: [
      { ref: '#207', label: '#207', title: 'Issues fold', url: 'https://github.com/me/app/issues/207' },
      { ref: '#208', label: '#208', title: 'Read an issue' },
    ] });
    await stop?.(); stop = undefined;
    const refused = await offered(['#207', '#999']);
    expect(refused.items.some((item) => item.kind === 'issueOffer')).toBe(false);
    expect(refused.items.find((item) => item.kind === 'tool')).toMatchObject({ id: 'offer-1' });
  });

  it('starts a claimed thread on a ready issue, records it, and refuses blocked or started ones', async () => {
    const { c, thread, harness, assigned } = await offered(['#207', '#208']);
    expect((await c.call('threads.offeredIssues', { threadId: thread.id, offerId: 'offer-1' })).issues.map((entry) => [entry.ref, entry.issue?.blockedBy])).toEqual([['#207', []], ['#208', ['#207']]]);
    await expect(c.call('threads.implementIssue', { threadId: thread.id, offerId: 'offer-1', ref: '#208' })).rejects.toThrow('#208 waits on #207.');

    const started = await c.call('threads.implementIssue', { threadId: thread.id, offerId: 'offer-1', ref: '#207' });
    expect(started.title).toBe('#207 Issues fold');
    const planner = (await c.call('threads.list', {})).find((t) => t.id === thread.id)!;
    await settled(c, started.id);
    expect(harness.runs[1]!.prompt).toContain(implementMessage({ ref: '#207', title: 'Issues fold' }, threadHandle(planner)));
    await expect.poll(() => assigned).toEqual(['207']);
    const items = await c.call('threads.transcript', { threadId: thread.id });
    const offer = items.find((item): item is Extract<TranscriptItem, { kind: 'issueOffer' }> => item.kind === 'issueOffer')!;
    expect(offer.issues.map((i) => i.threadId)).toEqual([started.id, undefined]);
    await expect(c.call('threads.implementIssue', { threadId: thread.id, offerId: 'offer-1', ref: '#207' })).rejects.toThrow('#207 already has a thread.');
  });
});
