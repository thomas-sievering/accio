import { expect, test } from '@playwright/test';
import { TestClient } from '../apps/worker/src/testing/testApp.js';

test('revoking a paired machine from Settings → Machines asks first, and the machine goes offline', async ({ page, baseURL }, info) => {
  await page.goto(`${baseURL}/#token=relay-test-token`);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('.sidebar nav').getByRole('button', { name: 'Machines', exact: true }).click();
  const row = (name: string) => page.locator('.machine-row').filter({ has: page.getByRole('button', { name, exact: true }) });
  await expect(row('Old laptop')).toContainText('Connected');

  // This machine can't revoke itself.
  await page.getByRole('button', { name: 'PC (this machine)', exact: true }).click();
  await expect(page.getByRole('textbox', { name: /^Machine name/ })).toHaveValue('PC');
  await expect(page.getByRole('button', { name: 'Revoke', exact: true })).toHaveCount(0);
  await page.locator('.settings-actions').getByRole('button', { name: 'Cancel', exact: true }).click();

  await page.getByRole('button', { name: 'Old laptop', exact: true }).click();
  await page.getByRole('button', { name: 'Revoke', exact: true }).click();
  const confirm = page.getByRole('group', { name: 'Revoke Old laptop?', exact: true });
  await expect(confirm).toContainText('Old laptop loses access to Home, and its hat keys are deleted on the Sorting Hat. Its threads stay on that machine. To use Home again, it must be paired with a new code.');
  await expect(confirm.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await confirm.screenshot({ path: info.outputPath('revoke-confirm.png') });

  // Escape cancels the confirmation and stays on the machine.
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: /^Machine name/ })).toHaveValue('Old laptop');

  await page.getByRole('button', { name: 'Revoke', exact: true }).click();
  await confirm.getByRole('button', { name: 'Revoke Old laptop', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add machine', exact: true })).toBeVisible();
  await expect(row('Old laptop')).toContainText('Offline');
  await expect(row('MacBook')).toContainText('Connected');

  // A second observation: the hub no longer counts it as connected, and it stays out after its reconnect attempts.
  const client = await TestClient.open(`${baseURL!.replace('http:', 'ws:')}/ws?token=relay-test-token`);
  try {
    const connected = async () => (await client.call('machines.list', {})).find(machine => machine.name === 'Old laptop')?.connected;
    expect(await connected()).toBe(false);
    await page.waitForTimeout(2_000);
    expect(await connected()).toBe(false);
  } finally { client.close(); }
});
