import { expect, test } from '@playwright/test';

const token = 'isolated-chat-test-token';

test('a step only the user can do brings the running thread to the inbox until Done tells the agent', async ({ page, baseURL }, testInfo) => {
  await page.goto(`${baseURL}/#token=${token}`);
  const row = page.locator('.sidebar .row').filter({ has: page.locator('.row-title', { hasText: 'Needs you thread' }) });
  await row.click();
  await page.locator('.composer textarea').fill('Needs you fixture');
  await page.keyboard.press('Enter');

  const card = page.getByRole('region', { name: 'Needs you: Approve the sign-in in Authenticator (14)' });
  await expect(card).toContainText('Open Microsoft Authenticator on your phone and enter 14.');
  await expect(page.getByText('Waiting on you')).toBeVisible();
  // The turn keeps running, yet the row reads Needs you rather than Working. A row moving to
  // another section fades out of its old one, so for a moment two rows name the thread.
  const needsYou = row.locator('.row-state', { hasText: 'Needs you' });
  await expect(needsYou).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('needs-you-pending.png') });

  await card.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Heard: Done: Approve the sign-in in Authenticator (14)')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Approve the sign-in in Authenticator (14)' })).toContainText('Done');
  await expect(needsYou).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('needs-you-done.png') });
});
