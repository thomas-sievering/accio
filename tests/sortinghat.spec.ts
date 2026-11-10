import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/** Saves a screenshot when SORTING_HAT_SCREENSHOTS names a folder (keep it outside the repository). */
async function shot(page: Page, name: string, target: Page | ReturnType<Page['locator']> = page) {
  const dir = process.env.SORTING_HAT_SCREENSHOTS;
  if (dir) await target.screenshot({ path: join(dir, `${name}.png`), ...(target === page ? { fullPage: true } : {}) });
}

test('the Sorting Hat dashboard signs accounts in, sets up a house and hands out a hat key once', async ({ page, context, baseURL, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL });
  const button = (name: string, scope = page.locator('body')) => scope.getByRole('button', { name, exact: true });
  const dialog = page.locator('dialog[open]');
  const account = (name: string) => page.getByRole('article', { name: `Account ${name}`, exact: true });
  const house = (name: string) => page.getByRole('article', { name: `House ${name}`, exact: true });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
  await expect(page.getByText('On this machine')).toBeVisible();
  await expect(page.getByText('No accounts yet.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Usage' })).toBeVisible();

  // Claude accounts: the paste-code flow, with the code Anthropic's page would show.
  const addClaude = async (name: string) => {
    await button('Add Claude account').click();
    await dialog.getByRole('textbox', { name: 'Account name' }).fill(name);
    await button('Add and sign in', dialog).click();
    const link = dialog.getByRole('link', { name: 'Open Claude sign-in' });
    const url = new URL((await link.getAttribute('href'))!);
    expect(url.hostname).toBe('claude.ai');
    await dialog.getByRole('textbox', { name: 'Code' }).fill(`pasted#${url.searchParams.get('state')}`);
    await button('Finish sign-in', dialog).click();
    await expect(dialog).toBeHidden();
    await expect(account(name).getByText('Signed in', { exact: true })).toBeVisible();
  };
  await addClaude('Personal Claude');
  await addClaude('Work Claude');

  // A wrong code is refused in the dialog; cancelling leaves the account as it was.
  await button('Sign in again', account('Work Claude')).click();
  await dialog.getByRole('textbox', { name: 'Code' }).fill('bad#state');
  await button('Finish sign-in', dialog).click();
  await expect(dialog.getByRole('alert')).not.toBeEmpty();
  await button('Cancel', dialog).click();
  await expect(dialog).toBeHidden();

  // A ChatGPT account with the device flow: the dashboard polls until the provider approves.
  await button('Add ChatGPT account').click();
  await dialog.getByRole('textbox', { name: 'Account name' }).fill('Personal ChatGPT');
  await button('Add and sign in', dialog).click();
  await button('Sign in with a code', dialog).click();
  await expect(dialog.getByLabel('Device code')).toHaveText('TEST-1234');
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  await expect(account('Personal ChatGPT').getByText('Signed in', { exact: true })).toBeVisible();
  await expect(account('Personal ChatGPT')).toContainText('chatgpt-personal@example.com');

  // Rename an account.
  await button('Rename', account('Work Claude')).click();
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Work');
  await button('Rename', dialog).click();
  await expect(account('Work')).toBeVisible();

  // A house with ordered accounts per provider.
  await button('New house').click();
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Personal');
  await button('Create house', dialog).click();
  await expect(house('Personal')).toContainText('personal');
  const claudeOrder = house('Personal').getByRole('group', { name: 'Claude accounts of Personal' });
  const addTo = async (provider: 'Claude' | 'ChatGPT', name: string) => {
    await house('Personal').getByRole('combobox', { name: `${provider} account to add to Personal` }).selectOption({ label: name });
    await button(`Add ${provider} account to Personal`).click();
    await expect(house('Personal').getByRole('group', { name: `${provider} accounts of Personal` }).getByRole('listitem').filter({ hasText: name })).toBeVisible();
  };
  await addTo('Claude', 'Personal Claude');
  await expect(claudeOrder.getByRole('listitem')).toHaveCount(1);
  await addTo('Claude', 'Work');
  await addTo('ChatGPT', 'Personal ChatGPT');
  await expect(claudeOrder.getByRole('listitem')).toHaveText([/Personal Claude.*In use/, /Work/]);
  await button('Move Work up').click();
  await expect(claudeOrder.getByRole('listitem')).toHaveText([/Work.*In use/, /Personal Claude/]);
  await expect(house('Personal').getByRole('group', { name: 'ChatGPT accounts of Personal' }).getByRole('listitem')).toHaveText([/Personal ChatGPT.*In use/]);
  await expect(account('Work')).toContainText('in use for Personal');

  // Limits show on each account.
  await button('Refresh limits').click();
  await expect(account('Work').getByRole('meter', { name: '5-hour' })).toHaveAttribute('aria-valuenow', '42');
  await expect(account('Personal ChatGPT').getByRole('meter').first()).toHaveAttribute('aria-valuenow', '64');

  // A hat key, shown once, with settings for the apps that use it.
  await button('New hat key', house('Personal')).click();
  await dialog.getByRole('textbox', { name: 'Hat key name' }).fill('pi on laptop');
  await button('Create hat key', dialog).click();
  const shown = dialog.getByLabel('Hat key', { exact: true });
  await expect(shown).toHaveText(/^hat-/);
  const secret = (await shown.textContent())!;
  await expect(dialog.getByLabel('Settings')).toHaveText(`ANTHROPIC_BASE_URL=${baseURL} ANTHROPIC_AUTH_TOKEN=${secret} claude`);
  await button('Copy hat key', dialog).click();
  await expect(button('Copied', dialog)).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(secret);
  await dialog.getByRole('tab', { name: 'Claude Code settings' }).click();
  expect(JSON.parse((await dialog.getByLabel('Settings').textContent())!)).toEqual({ env: { ANTHROPIC_BASE_URL: baseURL, ANTHROPIC_AUTH_TOKEN: secret } });
  await dialog.getByRole('tab', { name: 'pi-claude-bridge' }).click();
  const bridge = JSON.parse((await dialog.getByLabel('Settings').textContent())!);
  expect(bridge).toEqual({ 'claude-bridge': { type: 'api_key', key: 'not-used', env: { ANTHROPIC_BASE_URL: baseURL, ANTHROPIC_AUTH_TOKEN: secret, ANTHROPIC_API_KEY: '' } } });
  await button('Copy settings', dialog).click();
  expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))).toEqual(bridge);
  await shot(page, 'sorting-hat-new-hat-key', dialog);
  await button('Done', dialog).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('body')).not.toContainText(secret);
  const keyRow = house('Personal').getByRole('row', { name: 'Hat key pi on laptop' });
  await expect(keyRow).toContainText('Created');

  // The key works on the model route, until it is revoked.
  const model = () => request.post('/v1/messages', { headers: { authorization: `Bearer ${secret}` }, data: { model: 'claude-test', messages: [] } });
  expect((await model()).status()).toBe(200);
  await page.reload();
  await expect(page.locator('body')).not.toContainText(secret);
  await shot(page, 'sorting-hat-dashboard');
  await button('Revoke', keyRow).click();
  await button('Revoke', dialog).click();
  await expect(keyRow).toContainText('Revoked');
  expect((await model()).status()).toBe(401);

  // The remaining actions: rename a hat key and a house, delete them, sign out and delete accounts.
  await button('Rename', keyRow).click();
  await dialog.getByRole('textbox', { name: 'Name' }).fill('old pi');
  await button('Rename', dialog).click();
  const oldRow = house('Personal').getByRole('row', { name: 'Hat key old pi' });
  await button('Delete', oldRow).click();
  await button('Delete', dialog).click();
  await expect(house('Personal').getByText('No hat keys.')).toBeVisible();
  await button('Rename', house('Personal')).click();
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Home');
  await button('Rename', dialog).click();
  await expect(house('Home')).toBeVisible();
  await button('Remove Personal Claude from Home').click();
  await expect(claudeOrder).toHaveCount(0);
  await expect(house('Home').getByRole('group', { name: 'Claude accounts of Home' }).getByRole('listitem')).toHaveText([/Work.*In use/]);
  await button('Sign out', account('Personal Claude')).click();
  await button('Sign out', dialog).click();
  await expect(account('Personal Claude').getByText('Signed out', { exact: true })).toBeVisible();
  await button('Delete', account('Personal Claude')).click();
  await button('Delete account', dialog).click();
  await expect(account('Personal Claude')).toHaveCount(0);
  // An account still in a house cannot be deleted: the reason shows in the dialog.
  await button('Delete', account('Work')).click();
  await button('Delete account', dialog).click();
  await expect(dialog.getByRole('alert')).toContainText('house');
  await button('Cancel', dialog).click();
  await button('Delete', house('Home')).click();
  await button('Delete house', dialog).click();
  await expect(page.getByText('No houses yet.')).toBeVisible();

  expect(errors).toEqual([]);
});
