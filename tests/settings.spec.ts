import { test, expect } from '@playwright/test';

test('keeping unsaved settings edits never submits the form and discarding leaves the saved profile intact', async ({ page, baseURL }, info) => {
  await page.goto(`${baseURL}/#token=isolated-chat-test-token`);
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const section = (name: string) => page.locator('.sidebar nav').getByRole('button', { name, exact: true });
  await button('Settings').click();
  await section('Profiles').click();
  await page.getByRole('button', { name: /^Add profile/ }).click();
  const name = page.getByRole('textbox', { name: 'Name', exact: true });
  await name.fill('Guard original');
  await button('Add profile').click();
  await expect(name).toHaveValue('Guard original');
  await name.fill('Guard unsaved');
  await section('Projects').click();
  await expect(button('Discard')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(button('Save')).toBeFocused();
  await expect(name).toHaveValue('Guard unsaved');
  await section('Limits').click();
  await expect(button('Discard')).toBeVisible();
  await button('Keep editing').click();
  await expect(button('Save')).toBeFocused();
  await expect(name).toHaveValue('Guard unsaved');
  // Keeping edits must not submit through a reused button that becomes type=submit.
  await section('Projects').click();
  await expect(button('Discard')).toBeVisible();
  await page.screenshot({ path: info.outputPath('unsaved-settings.png') });
  await button('Discard').click();
  await section('Profiles').click();
  await page.getByRole('button', { name: /^Guard original No account selected$/ }).click();
  await expect(name).toHaveValue('Guard original');
  await expect(button('Save')).toBeDisabled();
});
