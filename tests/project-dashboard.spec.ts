import { expect, test, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { git } from '../apps/worker/src/git.js';
import { BROWSER_AUTHOR, initRepoWithOrigin } from '../apps/worker/src/testing/gitRepo.js';
import { chatClient, chatFixture, startProjectThread } from './chat.js';

test('the project dashboard lists the project’s threads by state and what recently shipped to main', async ({ page, baseURL }, info) => {
  test.setTimeout(60_000);
  const { deliveryFolder } = await chatFixture(baseURL!);
  const home = dirname(deliveryFolder);
  const folder = join(home, 'dashboard-project');
  const origin = join(home, 'dashboard-origin.git');
  await initRepoWithOrigin(folder, origin, { 'README.md': 'v1\n' }, { author: BROWSER_AUTHOR, message: 'Start the project' });
  // A GitHub merge commit, which the dashboard shows by its pull request title.
  await git(folder, 'checkout', '--quiet', '-b', 'feature');
  await writeFile(join(folder, 'README.md'), 'v2\n');
  await git(folder, 'commit', '--quiet', '-am', 'Change the readme');
  await git(folder, 'checkout', '--quiet', '-');
  await git(folder, 'merge', '--quiet', '--no-ff', 'feature', '-m', 'Merge pull request #12 from owner/feature', '-m', 'Explain the project in the readme');
  await git(folder, 'push', '--quiet');
  const client = await chatClient(baseURL!);
  // Fixture: the folder is added like any project; everything under test goes through the UI.
  const checkout = await client.call('checkouts.add', { path: folder, profileId: 'personal' });
  try {
    await startProjectThread(page, baseURL!, /dashboard-project/, 'Delivery follow-up');
    await expect(page.getByText('Fresh workspace ready.', { exact: true })).toBeVisible();

    // The breadcrumb's project name opens the dashboard with the project's threads.
    await page.locator('.thread-project-link', { hasText: 'dashboard-project' }).click();
    await page.getByRole('menuitem', { name: 'Dashboard', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'dashboard-project' })).toBeVisible();
    await expect(page.locator('.dashboard-rows .row-title', { hasText: 'Delivery follow-up' })).toBeVisible();
    // The Needs you heading already says Ready; the row does not repeat it.
    await expect(page.locator('.dashboard-rows .row', { hasText: 'Delivery follow-up' })).not.toContainText('Ready');

    // Recently shipped: one line per commit on main, a merge shown by its PR title.
    await expect(page.locator('.changelog li')).toHaveCount(2);
    await expect(page.locator('.changelog li').first()).toHaveText(/^Explain the project in the readme/);
    await expect(page.locator('.changelog li').nth(1)).toContainText('Start the project');
    await page.screenshot({ path: info.outputPath('project-dashboard.png') });

    // Opening a thread from the dashboard leaves it.
    await page.locator('.dashboard-rows .row-main').first().click();
    await expect(page.getByRole('heading', { name: 'dashboard-project' })).toHaveCount(0);
    await expect(page.getByText('Fresh workspace ready.', { exact: true })).toBeVisible();

    // The project's full Changelog is a fold on its dashboard.
    await page.locator('.thread-project-link', { hasText: 'dashboard-project' }).click();
    await page.getByRole('menuitem', { name: 'Dashboard', exact: true }).click();
    await page.locator('.dashboard-fold > summary', { hasText: 'Changelog' }).click();
    await expect(page.getByText('Nothing shipped yet.')).toBeVisible();
  } finally {
    await client.call('checkouts.remove', { id: checkout.id, deleteThreads: true }).catch(() => {});
    client.close();
  }
});


test('all settled project threads remain reachable beyond the first page', async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  const folder = await mkdtemp(join(tmpdir(), 'accio-settled-browser-'));
  const client = await chatClient(baseURL!);
  let checkoutId: string | undefined;
  try {
    const checkout = await client.call('checkouts.add', { path: folder, profileId: 'personal' });
    checkoutId = checkout.id;
    for (let index = 0; index < 12; index++) {
      const thread = await client.call('threads.start', { checkoutId: checkout.id, text: `Settled history ${index}` });
      await expect.poll(async () => (await client.call('threads.list', {})).find(t => t.id === thread.id)?.status).toBe('idle');
      await client.call('threads.settle', { threadId: thread.id });
    }
    await page.goto(`${baseURL}/#token=isolated-chat-test-token`);
    await page.locator('.sidebar').getByRole('button', { name: 'New thread', exact: true }).click();
    await page.getByRole('option', { name: new RegExp(folder.split(/[\\/]/).at(-1)!) }).click();
    await page.locator('.thread-project-link').click();
    await page.getByRole('menuitem', { name: 'Dashboard', exact: true }).click();
    const fold = page.locator('.dashboard-fold').filter({ has: page.locator('summary', { hasText: 'Settled' }) });
    await expect(fold).not.toHaveAttribute('open', '');
    await fold.locator('summary').click();
    await expect(fold.locator('.row-main')).toHaveCount(10);
    await fold.getByRole('button', { name: 'Show 2 more settled threads', exact: true }).click();
    await expect(fold.locator('.row-main')).toHaveCount(12);
    await fold.locator('.row-main').last().click();
    await expect(page.locator('.msg.user')).toContainText('Settled history');
  } finally {
    if (checkoutId) await client.call('checkouts.remove', { id: checkoutId, deleteThreads: true }).catch(() => {});
    client.close();
    await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

/**
 * Opens the project dashboard from the header of the thread just started with `text`, once
 * it is the open thread: the draft shows the message before the thread starts, and opens
 * the thread when it has, which would close a dashboard opened in between.
 */
async function openDashboard(page: Page, text: string, project: string) {
  await expect(page.locator('.msg.user', { hasText: text })).toBeVisible();
  await expect(page.locator('.row-main[aria-current="page"]', { hasText: text }).filter({ hasNotText: 'Draft' })).toBeVisible({ timeout: 20_000 });
  await expect(async () => {
    await page.locator('.thread-project-link', { hasText: project }).click();
    await page.getByRole('menuitem', { name: 'Dashboard', exact: true }).click({ timeout: 2_000 });
    await expect(page.getByRole('heading', { name: project })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

test('the Issues fold lists open issues in dependency order with a graph, narrowed by parent or feature', async ({ page, baseURL }, info) => {
  test.setTimeout(60_000);
  await chatFixture(baseURL!);
  await page.setViewportSize({ width: 1100, height: 760 });
  await startProjectThread(page, baseURL!, /issues-project/, 'Look over the issues');
  await openDashboard(page, 'Look over the issues', 'issues-project');
  const fold = page.locator('.dashboard-fold').filter({ has: page.locator('summary', { hasText: 'Issues' }) });
  await expect(fold).not.toHaveAttribute('open', '');
  await fold.locator('summary').click();
  const rows = fold.getByRole('list', { name: 'Open issues' }).locator('.issues-row');
  // #194 waits on #205, so it follows it; the others keep the tracker's order.
  await expect(rows.locator('.issues-label')).toHaveText(['#208', '#205', '#194', '#201']);
  await expect(rows.nth(2)).toContainText('waits on #205');
  await expect(rows.locator('.issues-state')).toHaveText(['Ready', 'Ready', 'Blocked', 'Ready']);
  // One dot per issue; a line from #205 down to #194, none from the independent issues.
  await expect(fold.locator('.issues-gutter circle')).toHaveCount(4);
  await expect(rows.nth(0).locator('.issues-gutter path')).toHaveCount(0);
  await expect(rows.nth(1).locator('.issues-gutter path')).toHaveCount(1);
  await expect(rows.nth(2).locator('.issues-gutter path')).toHaveCount(1);
  await page.screenshot({ path: info.outputPath('issues-fold.png') });

  await fold.getByRole('combobox', { name: 'Parent issue' }).selectOption('#190 Threads survive restarts');
  await expect(rows.locator('.issues-label')).toHaveText(['#205', '#194']);

  // Local issue files: blockers by number within their feature folder.
  await startProjectThread(page, baseURL!, /scratch-project/, 'Look over the local issues');
  await openDashboard(page, 'Look over the local issues', 'scratch-project');
  await fold.locator('summary').click();
  await expect(fold.locator('.issues-source')).toHaveText('.scratch');
  await fold.getByRole('combobox', { name: 'Feature folder' }).selectOption('relay-reconnect');
  await expect(rows.locator('.issues-label')).toHaveText(['01', '02']);
  await expect(rows.nth(1)).toContainText('waits on 01');
  await expect(rows.locator('.issues-state')).toHaveText(['Ready', 'Blocked']);
});

test('clicking an issue opens it in a reader whose Blocked by and Blocks links move it, a sheet in narrow windows', async ({ page, baseURL }, info) => {
  test.setTimeout(60_000);
  await chatFixture(baseURL!);
  await page.setViewportSize({ width: 1400, height: 800 });
  await startProjectThread(page, baseURL!, /scratch-project/, 'Read the local issues');
  await openDashboard(page, 'Read the local issues', 'scratch-project');
  const fold = page.locator('.dashboard-fold').filter({ has: page.locator('summary', { hasText: 'Issues' }) });
  await fold.locator('summary').click();
  await fold.getByRole('combobox', { name: 'Feature folder' }).selectOption('relay-reconnect');
  const rows = fold.getByRole('list', { name: 'Open issues' }).locator('.issues-row');

  // Wide: the reader sits beside the dashboard, and the row stays highlighted.
  await rows.filter({ hasText: 'Show a reconnecting state' }).getByRole('button').click();
  const reader = page.getByRole('complementary', { name: 'Issue' });
  await expect(reader.getByRole('heading', { name: 'Show a reconnecting state on the machine chip' })).toBeVisible();
  await expect(reader).toContainText('The machine chip says Reconnecting while the relay retries.');
  await expect(reader.locator('.issue-pill')).toHaveText('Blocked');
  await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(rows.nth(0)).not.toHaveAttribute('aria-current', 'true');
  await page.screenshot({ path: info.outputPath('issue-reader.png') });

  // Blocked by moves the reader and the highlight to 01, whose Blocks leads back.
  await reader.getByRole('button', { name: /01 Retry the relay handshake/ }).click();
  await expect(reader.getByRole('heading', { name: 'Retry the relay handshake after the hub restarts' })).toBeVisible();
  await expect(reader).toContainText('Machines stay offline.');
  await expect(reader.locator('.issue-pill')).toHaveText('Ready');
  await expect(reader.locator('.issue-triage')).toHaveText('ready-for-agent');
  await expect(rows.nth(0)).toHaveAttribute('aria-current', 'true');
  await expect(reader.getByRole('link', { name: /GitHub/ })).toHaveCount(0);
  await reader.getByRole('button', { name: /02 Show a reconnecting state/ }).click();
  await expect(reader.getByRole('heading', { name: 'Show a reconnecting state on the machine chip' })).toBeVisible();

  // Esc closes the reader before the dashboard.
  await page.keyboard.press('Escape');
  await expect(reader).toHaveCount(0);
  await expect(rows.nth(1)).not.toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('heading', { name: 'scratch-project' })).toBeVisible();

  // Narrow: the reader is a sheet over the dashboard, and closes.
  await page.setViewportSize({ width: 900, height: 760 });
  await rows.first().getByRole('button').click();
  const sheet = page.getByRole('dialog', { name: /Retry the relay handshake/ });
  await expect(sheet).toContainText('Machines stay offline.');
  await expect(page.getByRole('complementary', { name: 'Issue' })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('issue-reader-sheet.png') });
  // Esc closes the sheet and leaves the dashboard; so does its Close button.
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'scratch-project' })).toBeVisible();
  await rows.first().getByRole('button').click();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'scratch-project' })).toBeVisible();
});

test('the reader starts a thread on a ready issue, claimed like the picker, and opens the thread of a claimed one', async ({ page, baseURL }, info) => {
  test.setTimeout(90_000);
  const { deliveryFolder } = await chatFixture(baseURL!);
  const home = dirname(deliveryFolder);
  // Its own local tracker, so the threads started here leave the shared fixture's issues alone.
  const folder = join(home, 'start-issue-project');
  const ready = '.scratch/onboarding/issues/01-welcome.md';
  const claimed = '.scratch/onboarding/issues/03-tour.md';
  await initRepoWithOrigin(folder, join(home, 'start-issue-origin.git'), {
    [ready]: '# Show a welcome card on first run\n\nStatus: ready-for-agent\n\nA card greets new users.\n',
    '.scratch/onboarding/issues/02-dismiss.md': '# Remember a dismissed welcome card\n\nBlocked by: 01\n\nThe card stays dismissed.\n',
    [claimed]: '# Offer a short tour\n\nStatus: claimed\n\nThree steps through the app.\n',
  }, { author: BROWSER_AUTHOR, message: 'Track the onboarding issues' });
  const client = await chatClient(baseURL!);
  const checkout = await client.call('checkouts.add', { path: folder, profileId: 'personal' });
  try {
    // Fixture: a thread already works on 03, as one started from the picker would.
    const touring = await client.call('threads.start', { checkoutId: checkout.id, text: `Work on ${claimed}: Offer a short tour`, issue: { ref: claimed, title: 'Offer a short tour' } });
    await expect.poll(async () => (await client.call('threads.list', {})).find((t) => t.id === touring.id)?.status, { timeout: 20_000 }).toBe('idle');
    // Settled, it still holds the claim, so the reader still opens it.
    await client.call('threads.settle', { threadId: touring.id });

    await page.setViewportSize({ width: 1400, height: 800 });
    await startProjectThread(page, baseURL!, /start-issue-project/, 'Plan the onboarding');
    await openDashboard(page, 'Plan the onboarding', 'start-issue-project');
    const fold = page.locator('.dashboard-fold').filter({ has: page.locator('summary', { hasText: 'Issues' }) });
    await fold.locator('summary').click();
    const rows = fold.getByRole('list', { name: 'Open issues' }).locator('.issues-row');
    await expect(rows.locator('.issues-label')).toHaveText(['01', '02', '03']);
    const reader = page.getByRole('complementary', { name: 'Issue' });
    const start = reader.getByRole('button', { name: 'Start a thread', exact: true });

    // A blocked issue can't be started.
    await rows.filter({ hasText: 'Remember a dismissed' }).getByRole('button').click();
    await expect(reader.locator('.issue-pill')).toHaveText('Blocked');
    await expect(start).toBeDisabled();

    // A claimed issue whose thread Accio knows opens it, even once that thread settled.
    await rows.filter({ hasText: 'Offer a short tour' }).getByRole('button').click();
    await expect(reader.locator('.issue-pill')).toHaveText('Claimed');
    await expect(start).toHaveCount(0);
    await reader.getByRole('button', { name: 'Open thread', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'start-issue-project' })).toHaveCount(0);
    await expect(page.locator('.msg.user', { hasText: `Work on ${claimed}` })).toBeVisible();

    // A ready issue starts a thread named from it and claimed in its worktree, as the picker does.
    // A started thread is already open, so its header opens the dashboard straight away.
    await page.locator('.thread-project-link', { hasText: 'start-issue-project' }).click();
    await page.getByRole('menuitem', { name: 'Dashboard', exact: true }).click();
    await fold.locator('summary').click();
    await rows.filter({ hasText: 'Show a welcome card' }).getByRole('button').click();
    await expect(reader.locator('.issue-pill')).toHaveText('Ready');
    await page.screenshot({ path: info.outputPath('issue-reader-start.png') });
    await start.click();
    const text = `Work on ${ready}: Show a welcome card on first run`;
    await expect(page.locator('.msg.user', { hasText: text })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'start-issue-project' })).toHaveCount(0);
    let started: typeof touring | undefined;
    await expect.poll(async () => (started = (await client.call('threads.list', {})).find((t) => t.issue === ready))?.workspace?.path, { timeout: 20_000 }).toBeTruthy();
    expect(started!.title).toBe('Show a welcome card on first run');
    await expect.poll(() => readFile(join(started!.workspace!.path, ready), 'utf8')).toContain('Status: claimed');

    // The checkout's file still says ready; the reader now opens the thread instead of starting another.
    await page.locator('.thread-project-link', { hasText: 'start-issue-project' }).click();
    await page.getByRole('menuitem', { name: 'Dashboard', exact: true }).click();
    await fold.locator('summary').click();
    await rows.filter({ hasText: 'Show a welcome card' }).getByRole('button').click();
    await expect(reader.getByRole('button', { name: 'Open thread', exact: true })).toBeVisible();
    await expect(start).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('issue-reader-open-thread.png') });
  } finally {
    await client.call('checkouts.remove', { id: checkout.id, deleteThreads: true }).catch(() => {});
    client.close();
  }
});

test('a GitHub issue’s reader shows the body read through gh and links to GitHub', async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  await chatFixture(baseURL!);
  await page.setViewportSize({ width: 1400, height: 800 });
  await startProjectThread(page, baseURL!, /issues-project/, 'Read the GitHub issues');
  await openDashboard(page, 'Read the GitHub issues', 'issues-project');
  const fold = page.locator('.dashboard-fold').filter({ has: page.locator('summary', { hasText: 'Issues' }) });
  await fold.locator('summary').click();
  await fold.locator('.issues-row', { hasText: '#194' }).getByRole('button').click();
  const reader = page.getByRole('complementary', { name: 'Issue' });
  await expect(reader).toContainText('The body of #194, read through gh.');
  await expect(reader.getByRole('link', { name: /GitHub/ })).toHaveAttribute('href', 'https://github.com/test/accio-issues/issues/194');
  await reader.getByRole('button', { name: /#205 Snoozed threads/ }).click();
  await expect(reader).toContainText('The body of #205, read through gh.');
  await expect(reader.getByRole('button', { name: /#194 Settle threads/ })).toBeVisible();
});

test('the Issues fold says why it is empty when the project has no tracker', async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  const folder = await mkdtemp(join(tmpdir(), 'accio-no-tracker-'));
  const client = await chatClient(baseURL!);
  const checkout = await client.call('checkouts.add', { path: folder, profileId: 'personal' });
  try {
    const name = folder.split(/[\\/]/).at(-1)!;
    await startProjectThread(page, baseURL!, new RegExp(name), 'No tracker here');
    await openDashboard(page, 'No tracker here', name);
    await page.locator('.dashboard-fold > summary', { hasText: 'Issues' }).click();
    await expect(page.getByText(/^No issue tracker\./)).toBeVisible();
  } finally {
    await client.call('checkouts.remove', { id: checkout.id, deleteThreads: true }).catch(() => {});
    client.close();
    await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
