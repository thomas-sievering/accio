import { expect, test } from '@playwright/test';
import { dirname, join } from 'node:path';
import { BROWSER_AUTHOR, initRepoWithOrigin } from '../apps/worker/src/testing/gitRepo.js';
import { chatClient, chatFixture, startProjectThread } from './chat.js';

test('one page at a time over a thread that stays mounted, and the page comes back on reload', async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  const home = dirname((await chatFixture(baseURL!)).deliveryFolder);
  const folder = join(home, 'pages-project');
  await initRepoWithOrigin(folder, join(home, 'pages-origin.git'), { 'README.md': 'v1\n' }, { author: BROWSER_AUTHOR, message: 'Start the project' });
  const client = await chatClient(baseURL!);
  // Fixture: the folder is added like any project; everything under test goes through the UI.
  const checkout = await client.call('checkouts.add', { path: folder, profileId: 'personal' });
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const dashboard = page.getByRole('heading', { name: 'pages-project' });
  const composer = page.locator('.composer textarea');
  try {
    await startProjectThread(page, baseURL!, /pages-project/, 'Delivery follow-up');
    await expect(page.getByText('Fresh workspace ready.', { exact: true })).toBeVisible();
    await composer.fill('An unsent follow-up');

    // Settings replace the window and Back returns to the same draft of the follow-up.
    await button('Settings').click();
    await expect(button('Back')).toBeVisible();
    await button('Back').click();
    await expect(composer).toHaveValue('An unsent follow-up');

    // Settings opened from the dashboard go back to it, and so does a reload.
    await page.locator('.thread-project-link', { hasText: 'pages-project' }).click();
    await page.getByRole('menuitem', { name: 'Dashboard', exact: true }).click();
    await expect(dashboard).toBeVisible();
    await page.getByRole('button', { name: 'pages-project settings', exact: true }).click();
    await expect(button('Back')).toBeVisible();
    await button('Back').click();
    await expect(dashboard).toBeVisible();
    await page.reload();
    await expect(dashboard).toBeVisible();

    // Limits replace the dashboard; closing them shows the thread with its follow-up.
    await button('Limits').click();
    await expect(button('Close limits')).toBeVisible();
    await expect(dashboard).toHaveCount(0);
    await button('Close limits').click();
    await expect(composer).toHaveValue('An unsent follow-up');

    // Settings come back on reload at the section they were on.
    await button('Settings').click();
    const nav = page.locator('.sidebar nav');
    await nav.getByRole('button', { name: 'Projects', exact: true }).click();
    await page.reload();
    await expect(nav.getByRole('button', { name: 'Projects', exact: true })).toHaveAttribute('aria-current', 'page');
    await button('Back').click();
    await expect(composer).toBeVisible();
  } finally {
    await client.call('checkouts.remove', { id: checkout.id, deleteThreads: true }).catch(() => {});
    client.close();
  }
});
