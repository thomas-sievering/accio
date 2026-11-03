import { expect, test, type WebSocketRoute } from '@playwright/test';

test('limits follow profiles and shared accounts through sign-in, retry, reset, settings and composer navigation', async ({ page, context, baseURL }, testInfo) => {
  const errors: string[] = [];
  let disconnected = false;
  const sockets: WebSocketRoute[] = [];
  await page.routeWebSocket('**/ws?*', (socket) => {
    if (disconnected) socket.close({ code: 1012, reason: 'Fixture disconnect' });
    else { socket.connectToServer(); sockets.push(socket); }
  });
  page.on('pageerror', (error) => errors.push(error.message));
  // Sign-in is faked only at the provider boundary; every Accio action uses its UI.
  await context.route('https://**/*', (route) => route.fulfill({ status: 200, body: 'Scripted provider consent.' }));
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const section = (name: string) => page.locator('.sidebar nav').getByRole('button', { name, exact: true });
  const card = (name: string) => page.getByRole('article', { name: new RegExp(`^${name},`) });
  const settings = async (name: string) => {
    if (await button('Settings').isVisible()) await button('Settings').click();
    await section(name).click();
  };
  const createAccount = async (name: string, code?: string, openai = false) => {
    await settings('Accounts');
    await page.getByRole('button', { name: new RegExp(`^Add ${openai ? 'ChatGPT' : 'Claude'} account`) }).click();
    await page.getByRole('textbox', { name: 'Account name' }).fill(name);
    await button('Add account').click();
    if (openai) {
      const opened = page.waitForEvent('popup'); await button('Sign in with ChatGPT').click();
      const popup = await opened; await popup.waitForURL(url => url.hostname === 'auth.openai.com'); await popup.close();
      await expect(page.getByText('Signed in as', { exact: false })).toBeVisible({ timeout: 10_000 });
    } else if (code) await signIn(code);
    await button('Cancel').click();
  };
  const signIn = async (code: string) => {
    const again = button('Sign in again');
    const opened = page.waitForEvent('popup'); await (await again.isVisible() ? again : button('Sign in with Claude')).click();
    const popup = await opened; await popup.waitForURL(url => url.hostname === 'claude.ai');
    // The provider fixture redirects through the real loopback callback, as browser approval does.
    const authorize = new URL(popup.url()); const callback = new URL(authorize.searchParams.get('redirect_uri')!);
    callback.searchParams.set('code', code); callback.searchParams.set('state', authorize.searchParams.get('state')!);
    await popup.goto(callback.href); await popup.close();
    await expect(page.getByText('Signed in as', { exact: false })).toBeVisible();
  };
  const selectAccounts = async (name: string, claude: string, chatgpt: string) => {
    await settings('Profiles');
    await page.getByRole('button', { name: new RegExp(`^${name} `) }).click();
    await page.getByRole('combobox', { name: /Anthropic · Claude account/ }).selectOption({ label: `${claude} · ${claude === 'Shared Claude' ? 'shared' : 'work'}@example.com` });
    await page.getByRole('combobox', { name: /OpenAI · ChatGPT account/ }).selectOption({ label: `${chatgpt} · shared-chatgpt@example.com` });
    await button('Save').click();
  };

  await page.goto(`${baseURL}/#token=isolated-limits-test-token`);
  await button('Continue').click();
  await page.getByPlaceholder('personal, work…').fill('Personal');
  await button('Continue').click();
  await button('Limits').click();
  await expect(page.getByText('No accounts selected for this profile.', { exact: true })).toBeVisible();
  await expect(page.locator('.limits-card, .limits-row')).toHaveCount(0);
  await button('Close limits').click();
  await createAccount('Shared Claude', 'shared');
  await createAccount('Team Claude', 'work');
  await createAccount('Shared ChatGPT', undefined, true);
  await settings('Profiles');
  await page.getByRole('button', { name: /^Add profile / }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Work');
  await button('Add profile').click();
  await button('Cancel').click();
  await selectAccounts('Personal', 'Shared Claude', 'Shared ChatGPT');
  await selectAccounts('Work', 'Team Claude', 'Shared ChatGPT');
  await button('Back').click();
  await button('Limits').click();
  await expect(button('Limits')).toHaveCount(1);
  await expect(button('Limits')).toHaveAttribute('aria-pressed', 'true');
  await button('Side panel').click();
  await expect(page.getByRole('complementary', { name: 'Side panel', exact: true })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Profile' })).toBeVisible();
  await button('Side panel').click();
  await expect(page.getByRole('radio', { name: 'All profiles' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.limits-card')).toHaveCount(3);
  await expect(page.getByText('Shared with Personal. One allowance, shown under Personal.', { exact: true })).toBeVisible();
  await button('Show limits').click();
  await expect(card('Shared ChatGPT')).toBeFocused();
  await expect(card('Shared Claude').getByRole('meter', { name: '5-hour allowance remaining' })).toHaveAttribute('aria-valuenow', '52');
  await expect(card('Shared Claude').locator('.limits-meters').getByRole('meter')).toHaveCount(3);
  await expect(card('Shared Claude').getByRole('meter', { name: 'Weekly allowance remaining', exact: true })).toHaveCount(1);
  await expect(card('Shared Claude').locator('.limit-pace.ahead')).toHaveCount(2);
  await expect(card('Shared Claude').locator('.limit-time-marker')).toHaveCount(2);
  await expect(card('Team Claude').locator('.limit-pace.behind')).toContainText('behind pace');
  await expect(card('Team Claude')).toContainText('Weekly limit reached.');
  await expect(card('Team Claude').getByRole('meter', { name: '5-hour allowance remaining' })).toHaveAttribute('aria-valuenow', '67');
  await expect(card('Team Claude').locator('.limit-meter.exhausted')).toHaveCSS('display', 'grid');
  await expect(card('Shared Claude').locator('details')).toHaveCount(0);
  await expect(card('Shared Claude').getByText('Unknown', { exact: true })).toHaveCount(0);
  await expect(card('Shared Claude').getByRole('meter', { name: 'Fable weekly allowance remaining' })).toBeVisible();
  await expect(card('Shared Claude').getByRole('meter', { name: 'Fable weekly allowance remaining' })).toHaveAttribute('aria-valuenow', '99');
  await page.screenshot({ path: testInfo.outputPath('all-profiles.png'), fullPage: true });

  // The provider's second Shared Claude read fails. The original snapshot must stay.
  const refresh = card('Shared Claude').getByRole('button', { name: 'Refresh this account’s limits' });
  await expect(refresh).toBeVisible({ timeout: 10_000 });
  await refresh.click();
  await expect(card('Shared Claude')).toContainText('Anthropic could not provide this account’s limits.');
  await expect(card('Shared Claude')).toContainText('Last known');
  await expect.poll(() => card('Shared Claude').locator('.limits-tag.warn').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(card('Shared Claude').getByRole('meter', { name: '5-hour allowance remaining' })).toHaveAttribute('aria-valuenow', '52');
  await expect(card('Shared Claude').getByRole('button', { name: /^Retry / })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('failed-refresh.png'), fullPage: true });
  await expect(card('Shared Claude').getByRole('button', { name: 'Retry', exact: true })).toBeEnabled({ timeout: 10_000 });
  await card('Shared Claude').getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(card('Shared Claude').getByText('Last known', { exact: true })).toHaveCount(0);

  disconnected = true;
  for (const socket of sockets) socket.close({ code: 1012, reason: 'Fixture disconnect' });
  await expect(page.getByText('Not connected to accio’s server.', { exact: false })).toBeVisible();
  await expect(card('Shared Claude')).toContainText('Last known');
  await expect(card('Shared Claude').getByRole('meter', { name: '5-hour allowance remaining' })).toHaveAttribute('aria-valuenow', '52');
  await expect(page.locator('.limits-refresh-all')).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('disconnected.png'), fullPage: true });
  disconnected = false;
  await expect(page.getByText('Not connected to accio’s server.', { exact: false })).toHaveCount(0);
  await expect(card('Shared Claude').getByText('Last known', { exact: true })).toHaveCount(0);

  // Radio keyboard behavior and narrow card layout; desktop chrome stays present.
  await page.getByRole('radio', { name: 'Personal', exact: true }).click();
  await expect(card('Shared ChatGPT')).toContainText('Shared with Work');
  await page.getByRole('radio', { name: 'Personal', exact: true }).press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Work', exact: true })).toBeFocused();
  await page.setViewportSize({ width: 820, height: 900 });
  await expect.poll(() => card('Team Claude').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('narrow.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });

  // Account settings entered from Limits return to Limits and signing out removes meters.
  await card('Team Claude').getByRole('button', { name: 'Team Claude settings' }).click();
  await expect(page.getByRole('textbox', { name: 'Account name' })).toHaveValue('Team Claude');
  await expect(page.locator('.account-limits').getByRole('meter')).toHaveCount(3);
  await expect(page.locator('.account-limits .limit-pace')).toHaveCount(2);
  await button('Sign out').click();
  await expect(page.locator('.account-limits')).toContainText('Signed out.');
  await button('Back').click();
  await expect(card('Team Claude').getByRole('meter')).toHaveCount(0);
  await card('Team Claude').getByRole('button', { name: 'Sign in', exact: true }).click();
  await signIn('work');
  await expect(page.locator('.account-limits').getByRole('meter')).toHaveCount(3);
  await button('Back').click();

  // Unselected account settings read limits too, and reauthentication rechecks immediately.
  await createAccount('Unused Claude', 'unknown');
  await page.getByRole('button', { name: /^Unused Claude / }).click();
  await expect(page.locator('.account-limits')).toContainText('Unknown');
  await expect(page.locator('.account-limits .limit-pace')).toHaveCount(1);
  await signIn('empty');
  await expect(page.locator('.account-limits')).toContainText('No limits were reported');
  await signIn('expired');
  await expect(page.locator('.account-limits')).toContainText('Reset time passed · awaiting confirmation');
  await expect(page.locator('.account-limits').getByRole('meter', { name: '5-hour allowance remaining' })).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('.account-limits .limit-pace')).toHaveCount(1);
  await button('Back').click();

  // The active draft, not the previous Limits selection, determines default scope.
  await button('Close limits').click();
  await page.locator('.sidebar').getByRole('button', { name: 'New thread', exact: true }).click();
  await page.getByRole('option', { name: 'No project', exact: true }).click();
  await page.getByRole('option', { name: /Personal/ }).click();
  await expect(page.locator('.limits-chip')).toBeVisible();
  await page.locator('.composer textarea').fill('A fixture-only turn');
  await page.locator('.limits-chip').click();
  await expect(page.getByRole('radio', { name: 'Personal', exact: true })).toHaveAttribute('aria-checked', 'true');
  await button('Close limits').click();
  await expect(page.locator('.composer textarea')).toHaveValue('A fixture-only turn');
  await expect(page.locator('.limits-chip')).toBeFocused();
  await page.locator('.limits-chip').click();
  await card('Shared Claude').getByRole('button', { name: 'Shared Claude settings' }).click();
  await button('Back').click();
  await button('Close limits').click();
  await expect(page.locator('.composer textarea')).toHaveValue('A fixture-only turn');
  await button('Send').click();
  await expect(page.getByText('Limits fixture reply', { exact: true })).toBeVisible();
  await page.locator('.composer textarea').fill('Unsent follow-up');
  await page.locator('.limits-chip').click();
  await expect(page.getByRole('radio', { name: 'Personal', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: /A fixture-only turn/ }).click();
  await expect(button('Close limits')).toHaveCount(0);
  await expect(page.locator('.composer textarea')).toHaveValue('Unsent follow-up');

  // A provider selected by another profile stays hidden when unselected here.
  await settings('Profiles');
  await page.getByRole('button', { name: /^Work / }).click();
  await page.getByRole('combobox', { name: /OpenAI · ChatGPT account/ }).selectOption('');
  await button('Save').click();
  await button('Back').click();
  await button('Limits').click();
  await page.getByRole('radio', { name: 'Work', exact: true }).click();
  await expect(card('Team Claude')).toBeVisible();
  await expect(page.locator('.limits-card')).toHaveCount(1);
  await expect(page.locator('.limits-page')).not.toContainText('OpenAI');
  await expect(button('Select account')).toHaveCount(0);
  await page.getByRole('radio', { name: 'All profiles', exact: true }).click();
  await expect(page.locator('.limits-profile').filter({ has: page.getByRole('heading', { name: 'Work', exact: true }) })).not.toContainText('OpenAI');
  await expect(card('Shared ChatGPT')).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('composer.png'), fullPage: true });
});
