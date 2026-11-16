import { expect, test } from '@playwright/test';

const token = 'isolated-chat-test-token';

test('add_cli asks before adding a CLI everywhere, and the answer shapes what the thread hears', async ({ page, baseURL }, testInfo) => {
  await page.goto(`${baseURL}/#token=${token}`);
  await page.getByRole('button', { name: /CLI fixture/ }).first().click();
  const pending = page.getByRole('region', { name: /^Needs your answer: Add/ });

  // Declined: nothing is saved, and the card collapses to a record.
  await page.locator('.composer textarea').fill('CLI fixture: declined-cli');
  await page.keyboard.press('Enter');
  await expect(pending).toContainText('Add declined-cli for every thread?');
  await expect(pending).toContainText('declined-cli@1.0.0');
  await expect(page.getByText('Waiting for your answer')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('confirmation-pending.png') });
  await pending.getByRole('button', { name: 'Decline' }).click();
  await expect(page.getByText('The user declined adding this CLI everywhere.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Add declined-cli for every thread?' })).toContainText('Declined');

  // Allowed: the CLI is saved Everywhere, installed and checked on this machine.
  await page.locator('.composer textarea').fill('CLI fixture: allowed-cli');
  await page.keyboard.press('Enter');
  await pending.getByRole('button', { name: 'Add everywhere' }).click();
  await expect(page.getByText(/Saved allowed-cli \(allowed-cli@1\.0\.0\) for every thread\..*Ready on this machine\./)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Add allowed-cli for every thread?' })).toContainText('Allowed');
  await page.screenshot({ path: testInfo.outputPath('confirmation-allowed.png') });
});
