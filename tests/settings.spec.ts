import { test, expect } from '@playwright/test';

for (const [sectionName, addName] of [
  ['Profiles', 'Add profile'], ['Accounts', 'Add ChatGPT account'], ['Secrets', 'Add secret'],
  ['CLIs', 'Add CLI'], ['MCP servers', 'Add MCP server'], ['Skills', 'Add skill source'], ['Hubs', 'Add hub'],
]) {
  test(`new ${sectionName} form guards typed input on Escape, section and breadcrumb navigation`, async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/#token=isolated-chat-test-token`);
    const nav = page.locator('.sidebar nav');
    const button = (name: string) => page.getByRole('button', { name, exact: true });
    await button('Settings').click();
    if (sectionName === 'Hubs') {
      await nav.getByRole('button', { name: /^Hub: / }).click();
      await page.getByRole('menuitem', { name: 'Manage hubs' }).click();
    } else await nav.getByRole('button', { name: sectionName, exact: true }).click();
    const add = page.getByRole('button', { name: new RegExp('^' + addName) });
    await expect(add).toBeEnabled();
    await add.click();
    const field = page.locator('.settings-page').getByRole('textbox').first();
    await field.fill('Unsaved form input');
    await field.press('Escape');
    await expect(page.getByRole('group', { name: 'Discard changes?', exact: true })).toBeVisible();
    await button('Keep editing').click();
    await expect(field).toHaveValue('Unsaved form input');
    await nav.getByRole('button', { name: 'System prompt', exact: true }).click();
    await expect(button('Discard')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(field).toHaveValue('Unsaved form input');
    await page.locator('.main-top .crumbs').getByRole('button').click();
    await expect(button('Discard')).toBeVisible();
    await button('Discard').click();
    await page.getByRole('button', { name: new RegExp('^' + addName) }).click();
    await expect(field).toHaveValue('');
    await field.press('Escape');
    await expect(button('Discard')).toHaveCount(0);
    await expect(page.getByRole('button', { name: new RegExp('^' + addName) })).toBeVisible();
  });
}

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
  await expect(button('Save')).toBeDisabled();
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
  await page.getByRole('button', { name: /^Guard original House Guard original · No account in its house$/ }).click();
  await expect(name).toHaveValue('Guard original');
  await expect(button('Save')).toBeDisabled();
  await name.press('Escape');
  await expect(page.getByRole('button', { name: /^Guard original House Guard original · No account in its house$/ })).toBeFocused();
});

test('Limits returns to its Settings origin and restores keyboard focus', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/#token=isolated-chat-test-token`);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const nav = page.locator('.sidebar nav');
  await nav.getByRole('button', { name: 'Projects', exact: true }).click();
  await nav.getByRole('button', { name: 'Limits', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Limits', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Close limits', exact: true }).click();
  await expect(nav.getByRole('button', { name: 'Projects', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('button', { name: 'Limits', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Limits', exact: true }).click();
  await page.getByRole('button', { name: 'Close limits', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Limits', exact: true })).toBeFocused();
});

test('a project preview command saves on Enter like the profile form', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/#token=isolated-chat-test-token`);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const projects = page.locator('.sidebar nav').getByRole('button', { name: 'Projects', exact: true });
  await projects.click();
  const row = page.getByRole('button', { name: /^delivery-project/ });
  await row.click();
  const command = page.getByRole('textbox', { name: /^Preview command/ });
  const original = await command.inputValue();
  await command.fill('node audit-preview.cjs');
  await command.press('Enter');
  await expect(row).toBeVisible();
  await row.click();
  await expect(command).toHaveValue('node audit-preview.cjs');
  await command.fill(original);
  await command.press('Enter');
  await expect(row).toBeVisible();
});

test('a Settings page whose item was deleted elsewhere says so and leads back; Delete asks first and Escape cancels', async ({ page, context, baseURL }) => {
  const url = `${baseURL}/#token=isolated-chat-test-token`;
  await page.goto(url);
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const section = (name: string) => page.locator('.sidebar nav').getByRole('button', { name, exact: true });
  await button('Settings').click();
  await section('Profiles').click();
  await page.getByRole('button', { name: /^Add profile/ }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Deleted elsewhere');
  await button('Add profile').click();
  await expect(page.locator('.main-top .crumbs')).toHaveText('Settings/Profiles/Deleted elsewhere');

  const other = await context.newPage();
  await other.goto(url);
  const nav = other.locator('.sidebar nav');
  await expect(nav.getByRole('button', { name: /^Hub: / }).or(other.getByRole('button', { name: 'Settings', exact: true })).first()).toBeVisible();
  if (await other.getByRole('button', { name: 'Settings', exact: true }).isVisible()) await other.getByRole('button', { name: 'Settings', exact: true }).click();
  await nav.getByRole('button', { name: 'Profiles', exact: true }).click();
  await other.getByRole('button', { name: /^Deleted elsewhere/ }).click();
  await other.getByRole('button', { name: 'Delete', exact: true }).click();
  const confirm = other.getByRole('group', { name: 'Delete Deleted elsewhere?', exact: true });
  await expect(confirm.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await other.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  await expect(other.locator('.main-top .crumbs')).toHaveText('Settings/Profiles/Deleted elsewhere');
  await other.getByRole('button', { name: 'Delete', exact: true }).click();
  await confirm.getByRole('button', { name: 'Delete Deleted elsewhere', exact: true }).click();
  await expect(other.getByRole('button', { name: /^Add profile/ })).toBeVisible();
  await other.close();

  await expect(page.locator('.settings-page')).toContainText('This profile no longer exists.');
  await expect(page.locator('.main-top .crumbs')).toHaveText('Settings/Profiles');
  await button('All profiles').click();
  await expect(page.getByRole('button', { name: /^Add profile/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Deleted elsewhere/ })).toHaveCount(0);
});
