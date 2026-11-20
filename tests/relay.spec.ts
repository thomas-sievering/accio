import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { TestClient } from '../apps/worker/src/testing/testApp.js';
import { newChatDraft } from './chat.js';

async function pasteImage(page: Page) {
  const data = (await readFile(resolve('tests/fixtures/chat.png'))).toString('base64');
  await page.locator('.composer textarea').evaluate((textarea, data) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob(data), c => c.charCodeAt(0))], 'image.png', { type: 'image/png' }));
    textarea.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, data);
}

test('lists a hub project only another machine has, and starts it there', async ({ page, baseURL }, info) => {
  await page.goto(`${baseURL}/#token=relay-test-token`);
  await page.locator('.sidebar').getByRole('button', { name: 'New thread', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search projects' }).fill('mac-only');
  await page.getByRole('option', { name: 'mac-only', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What should we build in mac-only?' })).toBeVisible();
  await page.getByRole('button', { name: 'Run on machine: PC', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Run on machine' });
  await expect(menu.getByRole('menuitemradio', { name: /^PC/ })).toContainText('This machine · No checkout yet');
  await page.screenshot({ path: info.outputPath('hub-project-machines.png') });
  await menu.getByRole('menuitemradio', { name: 'MacBook', exact: true }).click();
  await page.locator('.composer textarea').fill('Start in mac-only');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.thread-machine')).toContainText('MacBook');
  await expect(page.locator('.thread-project-name')).toContainText('mac-only');
  await expect(page.locator('.msg.assistant').last()).toContainText('MacBook here.');
});

test('lists another machine\'s folder without a remote while it is online, and runs its thread there', async ({ page, baseURL }, info) => {
  test.setTimeout(60_000);
  await page.goto(`${baseURL}/#token=relay-test-token`);
  await page.getByRole('button', { name: 'Filter threads', exact: true }).click();
  const scope = page.getByRole('menu', { name: 'Filter threads' });
  await expect(scope.getByRole('menuitemradio', { name: /^mac-notes/ })).toContainText('On MacBook');
  await page.screenshot({ path: info.outputPath('filter-elsewhere.png') });
  await page.keyboard.press('Escape');

  const picker = page.locator('.sidebar').getByRole('button', { name: 'New thread', exact: true });
  await picker.click();
  await page.getByRole('combobox', { name: 'Search projects' }).fill('mac-notes');
  await page.getByRole('option', { name: /^mac-notes/ }).click();
  await expect(page.getByRole('heading', { name: 'What should we build in mac-notes?' })).toBeVisible();
  // Only the MacBook has it, so the thread runs there.
  await page.getByRole('button', { name: 'Run on machine: MacBook', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Run on machine' });
  await expect(menu.getByRole('menuitemradio')).toHaveText(['MacBook']);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: info.outputPath('folder-elsewhere-draft.png') });
  await page.locator('.composer textarea').fill('Start in mac-notes');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.thread-machine')).toContainText('MacBook');
  await expect(page.locator('.thread-project-name')).toContainText('mac-notes');
  await expect(page.locator('.msg.assistant').last()).toContainText('MacBook here.');

  // With the MacBook off the relay it leaves the list once the grace runs out, and is back with it.
  const client = await TestClient.open(`${baseURL!.replace('http:', 'ws:')}/ws?token=relay-test-token`);
  try {
    const checkoutId = (await client.call('projects.get', {})).checkouts[0]!.id;
    await client.call('threads.start', { checkoutId, text: 'Put the MacBook to sleep' });
    await expect.poll(async () => (await client.call('projects.get', {})).elsewhere?.some((p) => p.name === 'mac-notes'), { timeout: 20_000 }).toBe(false);
    await picker.click();
    await page.getByRole('combobox', { name: 'Search projects' }).fill('mac-notes');
    await expect(page.getByRole('option', { name: /^mac-notes/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await client.call('threads.start', { checkoutId, text: 'Wake the MacBook' });
    await expect.poll(async () => (await client.call('projects.get', {})).elsewhere?.some((p) => p.name === 'mac-notes'), { timeout: 20_000 }).toBe(true);
  } finally { client.close(); }
});

test('an offline machine\'s threads move to the Offline shelf and come back with it', async ({ page, baseURL }, info) => {
  // Each move waits out the flicker grace (10 s).
  test.setTimeout(60_000);
  await page.goto(`${baseURL}/#token=relay-test-token`);
  const inbox = page.locator('.sidebar .row:not(.shelf .row)').filter({ hasText: 'Hello from the MacBook' });
  const shelf = page.locator('.shelf').filter({ has: page.locator('.shelf-head', { hasText: 'Offline' }) });
  await expect(inbox).toBeVisible();
  const client = await TestClient.open(`${baseURL!.replace('http:', 'ws:')}/ws?token=relay-test-token`);
  try {
    const checkoutId = (await client.call('projects.get', {})).checkouts[0]!.id;
    await client.call('threads.start', { checkoutId, text: 'Put the MacBook to sleep' });
    // A short drop doesn't move the row: it stays in the inbox, greyed, until the grace runs out.
    await expect(inbox.locator('.row-machine.offline')).toBeVisible();
    await expect(inbox).toBeVisible();
    await expect(shelf).toHaveCount(0);
    await expect(inbox).toHaveCount(0, { timeout: 15_000 });
    await expect(shelf.locator('.shelf-count')).toHaveText(/^\d+$/);
    await shelf.locator('.shelf-head').click();
    await expect(shelf.locator('.row').filter({ hasText: 'Hello from the MacBook' })).toBeVisible();
    await page.screenshot({ path: info.outputPath('offline-shelf.png') });
    await client.call('threads.start', { checkoutId, text: 'Wake the MacBook' });
    await expect(inbox).toBeVisible({ timeout: 15_000 });
    await expect(inbox.locator('.row-machine.offline')).toHaveCount(0);
    await expect(shelf).toHaveCount(0);
  } finally { client.close(); }
});

test('remote actions match relay support and become read-only when the owner goes offline', async ({ page, baseURL }, info) => {
  let uploads = 0;
  await page.routeWebSocket('**/ws?*', socket => {
    const server = socket.connectToServer();
    socket.onMessage(message => { if (JSON.parse(String(message)).method === 'threads.upload') uploads++; server.send(message); });
  });
  await page.goto(`${baseURL}/#token=relay-test-token`);
  await newChatDraft(page);
  await page.locator('.composer textarea').fill('Relay cleanup check');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await pasteImage(page);
  await expect(page.locator('.composer-image')).not.toHaveClass(/uploading/);
  const localUploads = uploads;
  await page.getByRole('button', { name: 'Run on machine: PC', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'MacBook', exact: true }).click();
  await expect(page.locator('.composer-error')).toContainText('Sending images to another machine is not supported yet.');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Remove Pasted image' }).click();
  await pasteImage(page);
  await expect(page.locator('.composer-image')).toHaveCount(0);
  expect(uploads).toBe(localUploads);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.thread-machine')).toContainText('MacBook');
  await expect(page.locator('.msg.assistant').last()).toContainText('MacBook here.');
  await page.getByRole('button', { name: /^Rename thread:/ }).click();
  await page.getByRole('textbox', { name: 'Thread title' }).fill('Remote cleanup verified');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Rename thread: Remote cleanup verified' })).toBeVisible();
  if (await page.getByRole('button', { name: 'Side panel', exact: true }).getAttribute('aria-pressed') !== 'true') await page.getByRole('button', { name: 'Side panel', exact: true }).click();
  await page.getByRole('tab', { name: 'Skills', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toContainText('This action is only available on the thread');

  // Revoke the disposable peer at the real hub boundary: the relay must mark it offline.
  const client = await TestClient.open(`${baseURL!.replace('http:', 'ws:')}/ws?token=relay-test-token`);
  try {
    const mac = (await client.call('machines.list', {})).find(machine => machine.name === 'MacBook')!;
    const hub = (await client.call('hubs.list', {}))[0]!;
    await client.call('hubs.revokeMachine', { id: hub.id, machineId: mac.id });
    await expect(page.locator('.thread-machine')).toContainText('(offline)');
    await expect(page.locator('.notice-bar')).toContainText('MacBook is offline.');
    await page.locator('.composer textarea').fill('Cannot send offline');
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: /^Select model:/ })).toBeDisabled();
    await expect(page.getByRole('button', { name: /^Rename thread:/ })).toBeDisabled();
    await page.getByRole('button', { name: 'Thread actions', exact: true }).click();
    const menu = page.getByRole('menu', { name: 'Thread actions', exact: true });
    for (const name of ['Rename…', 'Regenerate title', 'Snooze until morning', 'Settle', 'Delete thread']) await expect(menu.getByRole('menuitem', { name, exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    const row = page.locator('.sidebar .row').filter({ hasText: 'Remote cleanup verified' });
    await row.hover();
    for (const name of ['Snooze', 'Settle']) await expect(row.getByRole('button', { name, exact: true })).toBeDisabled();
    await page.screenshot({ path: info.outputPath('remote-offline.png') });

    // Without a loaded transcript, the pane says what this client last heard and offers Retry.
    // A fresh load places it on the Offline shelf at once.
    await page.reload();
    await page.locator('.shelf-head', { hasText: 'Offline' }).click();
    await page.locator('.sidebar .row-main').filter({ hasText: 'Remote cleanup verified' }).click();
    await expect(page.locator('.offline-thread')).toContainText('MacBook is offline');
    await page.screenshot({ path: info.outputPath('remote-offline-pane.png') });
    const actions = page.locator('.offline-thread').getByRole('button');
    await expect(actions).toHaveText(['Retry']);
    // This machine's own thread still works.
    await page.locator('.sidebar .row-main').filter({ hasText: 'A thread on the PC' }).click();
    await page.locator('.composer textarea').fill('Local works');
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  } finally { client.close(); }
});
