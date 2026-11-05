import { expect, test } from '@playwright/test';

const token = 'isolated-chat-test-token';

test('typing @ lists the profile models, picking one inserts its handle, and the sent message shows a chip', async ({ page, baseURL }, testInfo) => {
  await page.goto(`${baseURL}/#token=${token}`);
  await page.locator('.sidebar').getByRole('button', { name: 'New thread', exact: true }).click();
  await page.getByRole('option', { name: 'No project', exact: true }).click();
  if (await page.getByRole('combobox', { name: 'Search profiles' }).isVisible()) await page.getByRole('option', { name: 'Personal', exact: true }).click();
  const input = page.locator('.composer textarea');
  const menu = page.getByRole('listbox', { name: 'Mention a model' });

  await input.pressSequentially('use @');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await page.screenshot({ path: testInfo.outputPath('mention-menu.png') });

  await input.pressSequentially('so');
  await expect(menu.getByRole('option')).toHaveText(['Sonnet']);
  // Enter picks rather than sends.
  await input.press('Enter');
  await expect(menu).toBeHidden();
  await expect(input).toHaveValue('use @sonnet ');

  await input.pressSequentially('for this, ask @');
  await expect(menu).toBeVisible();
  await input.press('Escape');
  await expect(menu).toBeHidden();
  await input.pressSequentially('h');
  await expect(menu).toBeHidden();
  await input.press('Backspace');
  await input.press('Backspace');
  await input.pressSequentially('@ha');
  await input.press('Tab');
  await expect(input).toHaveValue('use @sonnet for this, ask @haiku ');

  await input.press('Enter');
  const message = page.locator('.msg.user').first();
  await expect(message.locator('.mention')).toHaveText(['Sonnet', 'Haiku']);
  await expect(message).toContainText('for this, ask');
  await message.screenshot({ path: testInfo.outputPath('mention-chip.png') });
});
