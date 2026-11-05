import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { TestClient } from '../apps/worker/src/testing/testApp.js';

async function pasteImage(page: Page) {
  const data = (await readFile(resolve('tests/fixtures/chat.png'))).toString('base64');
  await page.locator('.composer textarea').evaluate((textarea, data) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob(data), c => c.charCodeAt(0))], 'image.png', { type: 'image/png' }));
    textarea.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, data);
}

test('remote actions match relay support and become read-only when the owner goes offline', async ({ page, baseURL }, info) => {
  let uploads = 0;
  await page.routeWebSocket('**/ws?*', socket => {
    const server = socket.connectToServer();
    socket.onMessage(message => { if (JSON.parse(String(message)).method === 'threads.upload') uploads++; server.send(message); });
  });
  await page.goto(`${baseURL}/#token=relay-test-token`);
  await page.locator('.sidebar').getByRole('button', { name: 'New thread', exact: true }).click();
  await page.getByRole('option', { name: 'No project', exact: true }).click();
  if (await page.getByRole('combobox', { name: 'Search profiles' }).isVisible()) await page.getByRole('option', { name: 'Personal', exact: true }).click();
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
    await expect(row.getByRole('button', { name: 'Settle', exact: true })).toBeDisabled();
    await page.screenshot({ path: info.outputPath('remote-offline.png') });
    // This machine's own thread still works.
    await page.locator('.sidebar .row-main').filter({ hasText: 'A thread on the PC' }).click();
    await page.locator('.composer textarea').fill('Local works');
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  } finally { client.close(); }
});
