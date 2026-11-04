import { expect, test, _electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { TestClient } from '../apps/server/src/testing/testApp.js';

test('new thread starts at the latest remote default branch while its source checkout stays stale', async ({ page, baseURL }, info) => {
  const exec = promisify(execFile);
  const git = async (cwd: string, ...args: string[]) => (await exec('git', ['-C', cwd, ...args], { windowsHide: true })).stdout.trim();
  const { deliveryFolder, deliveryOrigin } = JSON.parse(await readFile(resolve('out', `chat-test-${new URL(baseURL!).port}.json`), 'utf8'));
  const sourceRevision = await git(deliveryFolder, 'rev-parse', 'HEAD');
  const writer = join(dirname(deliveryFolder), 'fresh-base-writer');
  await git(dirname(deliveryFolder), 'clone', '--quiet', deliveryOrigin, writer);
  await git(writer, 'config', 'user.name', 'Accio Browser Test');
  await git(writer, 'config', 'user.email', 'browser@example.test');
  await writeFile(join(writer, 'remote-base.txt'), 'Fresh remote base\n');
  await git(writer, 'add', '.');
  await git(writer, 'commit', '--quiet', '-m', 'advance remote before thread creation');
  await git(writer, 'push', '--quiet', 'origin', 'main');
  const remoteRevision = await git(writer, 'rev-parse', 'HEAD');
  expect(await git(deliveryFolder, 'rev-parse', 'origin/main')).toBe(sourceRevision);

  await page.goto(`${baseURL}/#token=isolated-chat-test-token`);
  await page.getByRole('button', { name: 'New thread', exact: true }).first().click();
  await page.getByRole('option', { name: /delivery-project/ }).click();
  await page.locator('.composer textarea').fill('Delivery follow-up');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Fresh workspace ready.', { exact: true })).toBeVisible();

  const client = await TestClient.open(`${baseURL!.replace('http:', 'ws:')}/ws?token=isolated-chat-test-token`);
  try {
    const thread = (await client.call('threads.list', {})).find(entry => entry.workspace?.sourcePath === deliveryFolder && entry.workspace.startRevision === remoteRevision);
    expect(thread).toBeDefined();
    expect(await git(thread!.workspace!.path, 'rev-parse', 'HEAD')).toBe(remoteRevision);
    expect(await readFile(join(thread!.workspace!.path, 'remote-base.txt'), 'utf8')).toBe('Fresh remote base\n');
    expect(await git(deliveryFolder, 'rev-parse', 'HEAD')).toBe(sourceRevision);
    expect(await git(deliveryFolder, 'status', '--porcelain')).toBe('');
    await writeFile(info.outputPath('fresh-base.json'), JSON.stringify({ sourceRevision, remoteRevision, thread }, null, 2));
  } finally { client.close(); }
  await page.screenshot({ path: info.outputPath('new-thread-fresh-base.png') });
});

test('an unavailable origin keeps the new-thread draft and reports the fetch failure', async ({ page, baseURL }) => {
  const exec = promisify(execFile);
  const git = async (...args: string[]) => exec('git', args, { windowsHide: true });
  const { deliveryFolder, deliveryOrigin } = JSON.parse(await readFile(resolve('out', `chat-test-${new URL(baseURL!).port}.json`), 'utf8'));
  const client = await TestClient.open(`${baseURL!.replace('http:', 'ws:')}/ws?token=isolated-chat-test-token`);
  const before = (await client.call('threads.list', {})).map(thread => thread.id).sort();
  try {
    await git('-C', deliveryFolder, 'remote', 'set-url', 'origin', join(dirname(deliveryFolder), 'unavailable.git'));
    await page.goto(`${baseURL}/#token=isolated-chat-test-token`);
    await page.getByRole('button', { name: 'New thread', exact: true }).first().click();
    await page.getByRole('option', { name: /delivery-project/ }).click();
    const input = page.locator('.composer textarea');
    await input.fill('Keep this draft after a failed fetch');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.composer-error')).toContainText('Could not fetch origin’s latest default branch');
    await expect(input).toHaveValue('Keep this draft after a failed fetch');
    expect((await client.call('threads.list', {})).map(thread => thread.id).sort()).toEqual(before);
  } finally {
    client.close();
    await git('-C', deliveryFolder, 'remote', 'set-url', 'origin', deliveryOrigin);
  }
});

test('CI wait shows current job and step, refreshes, survives reload and clears on delivery', async ({ page, baseURL }, testInfo) => {
  await page.goto(`${baseURL}/#token=isolated-chat-test-token`);
  await page.getByRole('button', { name: 'New thread', exact: true }).first().click();
  await page.getByRole('option', { name: /ci-progress-project/ }).click();
  await page.locator('.composer textarea').fill('Build CI progress fixture');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('CI fixture ready.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ship', exact: true }).click();
  const status = page.locator('.delivery-row [role="status"]');
  await expect(status).toContainText('CI · Build image · 2 of 4');
  await expect(page.locator('.row-project').filter({ hasText: 'CI · step 2/4' })).toBeVisible();
  await expect(page.locator('.row.active .row-main')).toHaveAttribute('title', /CI · Build image · 2 of 4/);
  await page.getByText('CI details · 1 of 2 checks complete', { exact: true }).click();
  await expect(page.getByRole('link', { name: 'image ↗', exact: true })).toHaveAttribute('href', 'https://github.com/test/fixture/actions/runs/10/job/20');
  await expect(page.locator('.delivery-progress')).toContainText('Last checked');
  await page.screenshot({ path: testInfo.outputPath('ci-progress.png') });
  await page.reload();
  await expect(status).toContainText('Build image · 2 of 4');
  await page.getByRole('button', { name: 'Check now', exact: true }).click();
  await expect(status).toContainText('Push image · 3 of 4');
  await page.getByRole('button', { name: 'Check now', exact: true }).click();
  await expect(page.locator('.delivery-actions [role="status"]')).toContainText('Shipped to main');
  await expect(page.locator('.delivery-progress')).toHaveCount(0);
  await expect(page.locator('.row-project').filter({ hasText: 'CI ·' })).toHaveCount(0);
  await expect(page.getByText('Ship to main when ready.', { exact: true })).toHaveCount(1);
});

test('a conversation with no changes stops Ship without waiting for checks', async ({ page, baseURL }, testInfo) => {
  await page.goto(`${baseURL}/#token=isolated-chat-test-token`);
  await page.getByRole('button', { name: 'New thread', exact: true }).first().click();
  await page.getByRole('option', { name: /delivery-project/ }).click();
  await page.locator('.composer textarea').fill('Delivery follow-up');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Fresh workspace ready.', { exact: true })).toBeVisible();
  // With nothing to ship, Ship and its options are not offered at all.
  await expect(page.getByRole('button', { name: 'Ship', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Shipping options', exact: true })).toHaveCount(0);
  await expect(page.getByText('Waiting for checks', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Check now', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Archive', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Fresh workspace ready.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ship', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('nothing-to-ship.png') });
});

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
  await expect(actions.getByRole('button', { name: 'Reopen', exact: true })).toBeVisible();
  await expect(actions.locator('.delivery-settled')).toHaveCount(0);
  await expect(actions.locator('.delivery-status')).toHaveAttribute('title', 'Workspace retained');
  await expect(page.locator('.composer textarea')).toHaveAttribute('placeholder', 'Send a message to reopen this thread…');
  await expect(page.locator('.row.settled.active')).toContainText('Shipped');
  await expect(page.locator('.row.settled.active .row-main')).toHaveAttribute('title', /Shipped to main/);
  // The outcome is said once, by the chip; the transcript carries no receipt line.
  await expect(actions.locator('.delivery-rev')).toHaveText(/^[0-9a-f]{7}$/);
  await expect(page.locator('.thread .notice')).toHaveCount(0);
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
  await expect(page.getByRole('button', { name: 'Ship', exact: true })).toHaveCount(0);
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
