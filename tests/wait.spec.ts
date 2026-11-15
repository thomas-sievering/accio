import { expect, test } from '@playwright/test';

const token = 'isolated-chat-test-token';

test('a Wait shows above the composer, cancels from its bar, and wakes the thread with what was met', async ({ page, baseURL }, testInfo) => {
  await page.goto(`${baseURL}/#token=${token}`);
  await page.getByRole('button', { name: /Wait fixture/ }).first().click();
  const bar = page.getByRole('region', { name: 'Wait' });
  await expect(bar).toHaveCount(0);

  // A command that keeps running: the bar stays until it is cancelled, and no turn starts.
  await page.locator('.composer textarea').fill('Wait fixture: long');
  await page.keyboard.press('Enter');
  await expect(bar).toContainText('Waiting for `node -e "setTimeout(() => {}, 600000)"` to exit or');
  await expect(page.getByText('Waiting for the build.')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('wait-bar.png') });
  await bar.getByRole('button', { name: 'Cancel wait' }).click();
  await expect(bar).toHaveCount(0);
  await expect(page.locator('.msg.user.wake')).toHaveCount(0);

  // A command that exits: accio starts the next turn itself, marked as the Wait being met.
  await page.locator('.composer textarea').fill('Wait fixture: short');
  await page.keyboard.press('Enter');
  const wake = page.locator('.msg.user.wake');
  await expect(wake).toContainText('Wait met');
  await expect(wake).toContainText('exited with code 0');
  await expect(wake).toContainText('Your note: Check the short build');
  await expect(page.getByText('Woke up after the build.')).toBeVisible();
  await expect(bar).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('wait-met.png') });
});
