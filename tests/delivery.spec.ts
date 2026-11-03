import { expect, test, _electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('Ship menu, queued cancellation, owned preview, delivery, Archive and follow-up work through the real UI', async ({ page, baseURL }, testInfo) => {
  await page.goto(`${baseURL}/#token=isolated-chat-test-token`);
  await page.getByRole('button', { name: 'New thread', exact: true }).first().click();
  await page.getByRole('option', { name: /delivery-project/ }).click();
  await page.locator('.composer textarea').fill('Build delivery fixture');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Feature implemented. Running checks…', { exact: true })).toBeVisible();
  // The sidebar repeats the delivery status, so composer assertions stay inside the delivery row.
  const actions = page.locator('.delivery-actions');
  await page.getByRole('button', { name: 'Shipping options', exact: true }).click();
  await expect(page.getByRole('menuitemradio', { name: /Ship to main/ })).toBeVisible();
  await expect(page.getByRole('menuitemradio', { name: /Prepare for review/ })).toContainText('Never merges.');
  const menuBox = await page.getByRole('menu', { name: 'Shipping options', exact: true }).boundingBox();
  const shipBox = await page.getByRole('button', { name: 'Ship', exact: true }).boundingBox();
  expect(menuBox!.y + menuBox!.height).toBeLessThan(shipBox!.y);
  expect(shipBox!.y - menuBox!.y - menuBox!.height).toBeLessThan(20);
  expect(Math.abs(menuBox!.x - shipBox!.x)).toBeLessThan(150);
  await page.screenshot({ path: testInfo.outputPath('ship-menu.png') });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Ship', exact: true }).click();
  await expect(actions.getByText('Ships when done', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel queued delivery' }).click();
  await expect(actions.getByText('Ships when done', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stop', exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Ship', exact: true }).click();
  await expect(actions.getByText('Ships when done', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('ship-queued.png') });
  const opened = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open app', exact: true }).click();
  const preview = await opened;
  await expect(preview.locator('body')).toHaveText('Accio delivery preview');
  const previewUrl = preview.url();
  await preview.close();
  await expect(actions.getByRole('status')).toContainText('Shipped to main', { timeout: 20_000 });
  await expect(page.getByText('Ship to main when ready.', { exact: true })).toHaveCount(1);
  // Verified direct delivery settles automatically, keeps the conversation selected and retains its workspace.
  await expect(actions).toContainText('Thread settled · Workspace retained');
  await expect(page.locator('.composer textarea')).toHaveAttribute('placeholder', 'Send a message to reopen this thread…');
  await expect(page.locator('.row.settled.active')).toContainText('main');
  await expect(page.getByText(/^Shipped to main · [0-9a-f]{7} · .*Thread settled; workspace retained\.$/)).toHaveCount(1);
  await expect(actions.getByRole('button', { name: 'Reopen', exact: true })).toBeVisible();
  await expect(actions.getByRole('button', { name: 'Archive', exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('ship-delivered.png') });
  await page.reload();
  await expect(actions.getByRole('status')).toContainText('Shipped to main');
  await actions.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByText('Archived · history kept', { exact: true })).toBeVisible();
  await expect(page.getByText('Verification complete. Published the committed change.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open app', exact: true })).toHaveCount(0);
  await expect(fetch(previewUrl)).rejects.toThrow();
  await page.locator('.composer textarea').fill('Delivery follow-up');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Fresh workspace ready.', { exact: true })).toBeVisible();
  await expect(page.getByText('Archived · history kept', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ship', exact: true })).toBeVisible();
});

test('Electron Open app uses the native bridge and archives its real owned preview', async ({ baseURL }) => {
  test.setTimeout(60_000);
  const require = createRequire(import.meta.url);
  const home = await mkdtemp(join(tmpdir(), 'accio-delivery-electron-'));
  const executablePath = require(require.resolve('electron', { paths: [resolve('apps/desktop')] })) as string;
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined));
  const desktop = await _electron.launch({ executablePath, args: [resolve('tests/electron-shell.cjs'), `--user-data-dir=${home}`], env: { ...environment, ACCIO_CHAT_TEST_URL: baseURL!, ACCIO_CHAT_TEST_DOWNLOADS: home } });
  try {
    const page = await desktop.firstWindow();
    await page.getByRole('button', { name: 'New thread', exact: true }).first().click();
    await page.getByRole('option', { name: /delivery-project/ }).click();
    await page.locator('.composer textarea').fill('Build delivery fixture');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Feature implemented. Running checks…', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Open app', exact: true }).click();
    await expect.poll(() => desktop.evaluate(({ app }) => (app as any).chatPreviews.length)).toBe(1);
    const url = await desktop.evaluate(({ app }) => (app as any).chatPreviews[0] as string);
    expect(await (await fetch(url)).text()).toBe('Accio delivery preview');
    await page.getByRole('button', { name: 'Ship', exact: true }).click();
    await expect(page.locator('.delivery-actions').getByRole('status')).toContainText('Shipped to main', { timeout: 20_000 });
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    await expect(page.getByText('Archived · history kept', { exact: true })).toBeVisible();
    await expect(fetch(url)).rejects.toThrow();
  } finally {
    await desktop.close();
    if (!resolve(home).startsWith(join(tmpdir(), 'accio-delivery-electron-'))) throw new Error('Unexpected test home');
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
