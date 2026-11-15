import { expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
