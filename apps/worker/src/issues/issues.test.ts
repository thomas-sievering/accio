import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { issueMessage } from '@accio/protocol';
import { findTracker, Issues, localIssues, withStatus } from './issues.js';
import { runCommand } from '../resources/process.js';
import { FakeHarness } from '../testing/fakeHarness.js';
import { startTestApp } from '../testing/testApp.js';

const folders: string[] = [];
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });

async function repo(files: Record<string, string>, origin?: string) {
  const root = await mkdtemp(join(tmpdir(), 'accio-issues-')); folders.push(root);
  for (const [path, text] of Object.entries(files)) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text); }
  await runCommand('git', ['init', '--quiet', '-b', 'main'], { cwd: root });
  if (origin) await runCommand('git', ['remote', 'add', 'origin', origin], { cwd: root });
  return root;
}

const ghIssues = JSON.stringify([
  { number: 208, title: 'Retry the relay handshake', url: 'https://github.com/me/app/issues/208', labels: [{ name: 'ready-for-agent' }, { name: 'relay' }], assignees: [],
    blockedBy: { nodes: [] }, parent: { number: 190, title: 'Relay' } },
  { number: 194, title: 'Settle threads', labels: [], assignees: [{ login: 'me' }], blockedBy: { nodes: [{ number: 205, state: 'OPEN' }, { number: 150, state: 'CLOSED' }] }, parent: null },
]);

describe('issue trackers', () => {
  it('reads the tracker the agent skills name, then local issue files, then a GitHub origin', async () => {
    expect(await findTracker(await repo({ 'docs/agents/issue-tracker.md': '# Issue tracker: GitHub\n' }, 'https://github.com/me/app.git')))
      .toEqual({ kind: 'github', repository: 'me/app', configured: true });
    expect(await findTracker(await repo({ 'CLAUDE.md': '# App\n\n## Agent skills\n\n### Issue tracker\n\nIssues live as markdown files under `.scratch/`.\n\n### Domain docs\n' }, 'git@github.com:me/app.git')))
      .toEqual({ kind: 'local', configured: true });
    expect(await findTracker(await repo({ 'docs/agents/issue-tracker.md': '# Issue tracker: GitLab\n' }))).toEqual({ kind: 'unsupported', name: 'GitLab' });
    expect(await findTracker(await repo({ '.scratch/feature/issues/01-a.md': '# A\n' }, 'https://github.com/me/app'))).toEqual({ kind: 'local', configured: false });
    expect(await findTracker(await repo({}, 'git@github.com:me/app.git'))).toEqual({ kind: 'github', repository: 'me/app', configured: false });
    expect(await findTracker(await repo({}, 'https://gitlab.com/me/app.git'))).toBeUndefined();
  });

  it('lists open GitHub issues with their triage role, open blockers and parent', async () => {
    const root = await repo({}, 'https://github.com/me/app.git');
    const calls: string[][] = [];
    const issues = new Issues(async (_profile, _cwd, args) => { calls.push(args); return ghIssues; });
    const list = await issues.list('personal', root);
    expect(list.tracker).toEqual({ kind: 'github', repository: 'me/app' });
    expect(list.issues).toEqual([
      { ref: '#208', label: '#208', title: 'Retry the relay handshake', status: 'ready-for-agent', blockedBy: [], group: '#190 Relay', labels: ['relay'], assignees: [], url: 'https://github.com/me/app/issues/208' },
      { ref: '#194', label: '#194', title: 'Settle threads', blockedBy: ['#205'], labels: [], assignees: ['me'] },
    ]);
    await issues.list('personal', root);
    expect(calls).toHaveLength(1);
  });

  it('falls back for older gh, stays quiet for a guessed tracker, and explains a configured one', async () => {
    const guessed = await repo({}, 'https://github.com/me/app.git');
    const old = new Issues(async (_p, _c, args) => { if (args.at(-1)!.includes('blockedBy')) throw new Error('Unknown JSON field: "blockedBy"'); return '[{"number":1,"title":"One"}]'; });
    expect((await old.list('p', guessed)).issues).toMatchObject([{ ref: '#1', blockedBy: [] }]);
    const failing = new Issues(async () => { throw Object.assign(new Error('Command failed'), { stderr: 'gh: To get started, run gh auth login\n' }); });
    expect(await failing.list('p', guessed)).toEqual({ issues: [] });
    const configured = await repo({ 'docs/agents/issue-tracker.md': '# Issue tracker: GitHub\n' }, 'https://github.com/me/app.git');
    expect((await failing.list('p', configured)).unavailable).toBe('Couldn\'t read issues with gh: gh: To get started, run gh auth login');
  });

  it('lists open local issues by feature, with blockers that are still open', async () => {
    const root = await repo({
      '.scratch/relay/issues/01-retry.md': '# Retry the handshake\n\nStatus: ready-for-agent\n\nBody\n',
      '.scratch/relay/issues/02-chip.md': '# Reconnecting chip\n\nBlocked by: 01, 03\n',
      '.scratch/relay/issues/03-done.md': '# Old work\n\nStatus: resolved\n',
      '.scratch/relay/spec.md': '# Spec\n',
      '.scratch/picker/issues/01-detect.md': 'Status: claimed\n\n## Notes\nStatus: resolved\n',
    });
    expect(await localIssues(root)).toEqual([
      { ref: '.scratch/picker/issues/01-detect.md', label: '01', title: 'detect', status: 'claimed', blockedBy: [], group: 'picker', labels: [], assignees: [] },
      { ref: '.scratch/relay/issues/01-retry.md', label: '01', title: 'Retry the handshake', status: 'ready-for-agent', blockedBy: [], group: 'relay', labels: [], assignees: [] },
      { ref: '.scratch/relay/issues/02-chip.md', label: '02', title: 'Reconnecting chip', blockedBy: ['01'], group: 'relay', labels: [], assignees: [] },
    ]);
  });

  it('sets a Status line, adding one under the title when missing', () => {
    expect(withStatus('# T\n\nStatus: ready-for-agent\n\nBody\n', 'claimed')).toBe('# T\n\nStatus: claimed\n\nBody\n');
    expect(withStatus('# T\n\nBody\n', 'claimed')).toBe('# T\n\nStatus: claimed\n\nBody\n');
    expect(withStatus('# T\nBody\n', 'claimed')).toBe('# T\n\nStatus: claimed\n\nBody\n');
    expect(withStatus('Body\n', 'claimed')).toBe('Status: claimed\n\nBody\n');
  });

  it('names the issue and any notes in the first message', () => {
    expect(issueMessage({ ref: '#208', title: 'Retry' }, '  ')).toBe('Work on #208: Retry');
    expect(issueMessage({ ref: '#208', title: 'Retry' }, 'No jitter\n')).toBe('Work on #208: Retry\n\nNo jitter');
  });
});

describe('starting a thread from an issue', () => {
  let stop: (() => Promise<void>) | undefined;
  afterEach(async () => { await stop?.(); stop = undefined; });

  async function start(files: Record<string, string>, gh: (args: string[]) => Promise<string>) {
    const t = await startTestApp({ harness: new FakeHarness(), github: async (args) => gh(args) }); stop = t.stop;
    const c = await t.connect(); await c.signedIn('Personal');
    const folder = join(t.home, 'project');
    for (const [path, text] of Object.entries({ 'README.md': '# App\n', ...files })) { await mkdir(dirname(join(folder, path)), { recursive: true }); await writeFile(join(folder, path), text); }
    await runCommand('git', ['init', '--quiet', '-b', 'main'], { cwd: folder });
    await runCommand('git', ['remote', 'add', 'origin', 'https://github.com/me/app.git'], { cwd: folder });
    await runCommand('git', ['add', '.'], { cwd: folder });
    await runCommand('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--quiet', '-m', 'initial'], { cwd: folder });
    // The origin reads as GitHub but fetches from a local bare copy.
    const bare = join(t.home, 'origin.git');
    await runCommand('git', ['clone', '--quiet', '--bare', folder, bare], { cwd: t.home });
    await runCommand('git', ['config', `url.${bare}.insteadOf`, 'https://github.com/me/app.git'], { cwd: folder });
    await runCommand('git', ['fetch', '--quiet', 'origin'], { cwd: folder });
    const checkout = await c.call('checkouts.add', { path: folder, profileId: 'personal' });
    return { c, folder, checkout };
  }

  it('assigns a GitHub issue once the thread starts, and notes a claim that fails', async () => {
    const edits: string[][] = [];
    const { c, checkout } = await start({}, async (args) => {
      if (args[0] === 'issue' && args[1] === 'list') return ghIssues;
      if (args[0] === 'issue' && args[1] === 'edit') { edits.push(args); if (args[2] === '194') throw new Error('no permission'); return ''; }
      throw new Error('signed out');
    });
    expect((await c.call('threads.issues', { checkoutId: checkout.id })).issues.map((i) => i.ref)).toEqual(['#208', '#194']);
    const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'Work on #208: Retry the relay handshake', issue: { ref: '#208', title: 'Retry the relay handshake' } });
    expect(thread.title).toBe('#208 Retry the relay handshake');
    await expect.poll(() => edits).toEqual([['issue', 'edit', '208', '--add-assignee', '@me']]);
    const failed = await c.call('threads.start', { checkoutId: checkout.id, text: 'Work on #194: Settle threads', issue: { ref: '#194', title: 'Settle threads' } });
    await expect.poll(async () => (await c.call('threads.transcript', { threadId: failed.id })).some((i) => i.kind === 'notice' && i.text.startsWith('Could not claim #194: no permission'))).toBe(true);
    expect((await c.call('threads.transcript', { threadId: thread.id })).some((i) => i.kind === 'notice')).toBe(false);
  });

  it('marks a local issue claimed in the thread’s worktree, leaving the checkout alone', async () => {
    const ref = '.scratch/relay/issues/01-retry.md';
    const { c, folder, checkout } = await start({ [ref]: '# Retry\n\nStatus: ready-for-agent\n' }, async () => { throw new Error('no gh'); });
    expect(await c.call('threads.issues', { checkoutId: checkout.id })).toMatchObject({ tracker: { kind: 'local', folder: '.scratch' }, issues: [{ ref, status: 'ready-for-agent' }] });
    const thread = await c.call('threads.start', { checkoutId: checkout.id, text: `Work on ${ref}: Retry`, issue: { ref, title: 'Retry' } });
    expect(thread.title).toBe('Retry');
    const worktree = thread.workspace!.path;
    await expect.poll(async () => (await readFile(join(worktree, ref), 'utf8')).replace(/\r/g, '')).toBe('# Retry\n\nStatus: claimed\n');
    expect((await readFile(join(folder, ref), 'utf8')).replace(/\r/g, '')).toBe('# Retry\n\nStatus: ready-for-agent\n');
  });
});
