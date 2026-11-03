import { expect, test, type Page } from '@playwright/test';

/*
 * Secret entry and Settings / Secrets through the production UI.
 * Fixture (scripts/secrets-test-server.ts): signed-in Personal and Work, a git
 * project "secret-project" bound to Personal, and a running thread titled
 * "request secret" waiting on slot cloudflare.pages.deploy:docs. The prompt
 * "request secret" asks for the same slot again; "request alternate" asks for
 * another slot.
 *
 * Values are dummy markers. Traces, screenshots and video stay off so typed
 * values are never retained as evidence.
 */
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

const token = process.env.ACCIO_SECRETS_TEST_TOKEN ?? 'isolated-secrets-test-token';
const SAVED = 'accio-test-marker-saved-0001';
const REPLACED = 'accio-test-marker-replaced-0002';
const ONCE = '  accio-test-marker-once-0003  ';

const card = (page: Page) => page.locator('section.secret').last();
const valueField = (page: Page) => card(page).getByPlaceholder('Paste secret');

async function send(page: Page, text: string) {
  const composer = page.locator('textarea');
  await expect(composer).toBeEnabled({ timeout: 15_000 });
  await composer.fill(text);
  await composer.press('Enter');
}

async function expectNoMarkersStored(page: Page) {
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + location.href);
  for (const marker of [SAVED, REPLACED, ONCE.trim()]) expect(stored).not.toContain(marker);
}

test('save, reuse, manage, use once and decline a secret', async ({ page }) => {
  const consoleText: string[] = [];
  page.on('console', (m) => consoleText.push(m.text()));
  await page.goto(`/#token=${token}`);

  // Pending request: quiet mark on the Working row and the inline card.
  const row = page.locator('.row', { hasText: 'request secret' }).first();
  await row.getByRole('button').first().click();
  await expect(card(page)).toContainText('Needs a secret');
  await expect(card(page)).toContainText('Kept out of chat. Commands in this turn can read this secret.');
  await expect(card(page)).toContainText('secret-project');
  await expect(row).toContainText('Needs a secret');
  await expect(card(page).getByRole('button', { name: 'Save & use' })).toBeDisabled();

  // Save & use: the card collapses and the value field is cleared away.
  await valueField(page).fill(SAVED);
  await card(page).getByRole('button', { name: 'Save & use' }).click();
  await expect(card(page)).toContainText('Secret saved for this project');
  await expect(page.getByPlaceholder('Paste secret')).toHaveCount(0);
  await expect(row).not.toContainText('Needs a secret');

  // The same slot again resolves without any input or confirmation.
  await send(page, 'request secret');
  await expect(card(page)).toContainText(/Using /, { timeout: 15_000 });
  await expect(card(page)).toContainText('Saved for Personal / secret-project');
  await expect(page.getByPlaceholder('Paste secret')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save & use' })).toHaveCount(0);

  // Settings / Secrets sits right after Accounts.
  await page.getByRole('button', { name: 'Settings' }).click();
  const nav = page.locator('.settings-link');
  await expect(nav.nth(0)).toHaveText('Accounts');
  await expect(nav.nth(1)).toHaveText('Secrets');
  await nav.nth(1).click();
  await page.getByRole('combobox', { name: 'Profile', exact: true }).selectOption({ label: 'Personal' });
  const saved = page.locator('.secret-row').first();
  await expect(saved).toContainText('cloudflare.pages.deploy:docs');
  await expect(saved).toContainText('secret-project');

  // Replace keeps name and access; the value is never shown.
  await saved.getByRole('button', { name: /^Replace/ }).click();
  await expect(page.locator('.facts')).toContainText('secret-project');
  await page.getByLabel('New value').fill(REPLACED);
  await page.getByRole('button', { name: 'Replace value' }).click();
  await expect(page.locator('.secret-row')).toHaveCount(1);
  await expect(page.locator('body')).not.toContainText(REPLACED);

  // Scope: widen to every Personal project explicitly.
  await saved.locator('.secret-name').click();
  await page.getByLabel(/All Personal projects/).check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.secret-row').first()).toContainText('All Personal projects');

  // Work has its own (empty) list.
  await page.getByRole('combobox', { name: 'Profile', exact: true }).selectOption({ label: 'Work' });
  await expect(page.locator('.settings-card').last()).toContainText('No saved secrets for Work');
  await page.getByRole('combobox', { name: 'Profile', exact: true }).selectOption({ label: 'Personal' });

  // Delete asks within the row first.
  await page.locator('.secret-row').first().getByRole('button', { name: /^Delete/ }).click();
  await page.getByRole('button', { name: 'Delete secret' }).click();
  await expect(page.getByText('No saved secrets for Personal')).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();

  // Use once delivers without saving; whitespace is preserved by the server contract.
  await page.locator('.row', { hasText: 'request secret' }).first().getByRole('button').first().click();
  await send(page, 'request alternate');
  await expect(card(page)).toContainText('Needs a secret', { timeout: 15_000 });
  await valueField(page).fill(ONCE);
  await card(page).getByRole('button', { name: 'Use once' }).click();
  await expect(card(page)).toContainText('Secret supplied');
  await expect(card(page)).toContainText('For this turn');

  // Nothing was saved, so the next request asks again; decline it.
  await send(page, 'request alternate');
  await expect(card(page)).toContainText('Needs a secret', { timeout: 15_000 });
  await card(page).getByRole('button', { name: 'Decline' }).click();
  await expect(card(page)).toContainText('Declined');

  // No project never silently creates profile-wide memory.
  await page.getByRole('button', { name: 'New thread', exact: true }).click();
  await page.getByRole('option', { name: 'No project', exact: true }).click();
  await page.getByRole('option', { name: 'Personal', exact: true }).click();
  await send(page, 'request alternate');
  await expect(card(page)).toContainText('No project');
  await expect(card(page).getByRole('button', { name: 'Save & use' })).toHaveCount(0);
  await valueField(page).fill(ONCE);
  await card(page).getByRole('button', { name: 'Use once' }).click();
  await expect(card(page)).toContainText('Secret supplied');

  await expectNoMarkersStored(page);
  for (const marker of [SAVED, REPLACED, ONCE.trim()]) expect(consoleText.join('\n')).not.toContain(marker);
});
