import { expect, test, type Page } from '@playwright/test';
import { TestClient } from '../apps/worker/src/testing/testApp.js';

const token = 'isolated-chat-test-token';
const effort = (page: Page) => page.getByRole('button', { name: /^Effort:/ });

test('pane headers show their profile only while multiple profiles exist', async ({ page, baseURL }, info) => {
  await freshDraft(page, baseURL);
  await expect(page.locator('.main-top:visible .profile-label')).toHaveCount(0);
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  await button('Settings').click();
  await page.locator('.sidebar nav').getByRole('button', { name: 'Profiles', exact: true }).click();
  await page.getByRole('button', { name: /^Add profile/ }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Header work');
  await button('Add profile').click();
  await button('Cancel').click();
  await button('Back').click();
  await expect(page.locator('.main-top:visible .profile-label')).toHaveText('Personal');

  await button('New thread').first().click();
  await page.getByRole('option', { name: 'No project', exact: true }).click();
  await page.getByRole('option', { name: 'Header work', exact: true }).click();
  await expect(page.locator('.main-top:visible .profile-label')).toHaveText('Header work');

  await page.locator('.sidebar').getByRole('button', { name: /Inline chat fixture/ }).click();
  await expect(page.locator('.main-top:visible .profile-label')).toHaveText('Personal');
  await page.screenshot({ path: info.outputPath('thread-profile.png') });
  await button('New thread').first().click();
  await page.getByRole('option', { name: /delivery-project/ }).click();
  await expect(page.locator('.main-top:visible .profile-label')).toHaveText('Personal');
  await page.locator('.thread-project-link:visible').click();
  await page.getByRole('menuitem', { name: 'Dashboard', exact: true }).click();
  await expect(page.locator('.main-top:visible .profile-label')).toHaveText('Personal');
  await page.screenshot({ path: info.outputPath('project-profile.png') });

  await button('Settings').click();
  await page.locator('.sidebar nav').getByRole('button', { name: 'Profiles', exact: true }).click();
  await page.getByRole('button', { name: 'Header work No account selected', exact: true }).click();
  await button('Delete').click();
  await button('Delete Header work').click();
  await button('Back').click();
  await expect(page.locator('.main-top:visible .profile-label')).toHaveCount(0);
});

test('keyboard focus visibly reveals a complete title without moving adjacent rows', async ({ page, baseURL }, info) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await freshDraft(page, baseURL);
  await page.locator('.composer textarea').fill('Queued title tooltip');
  await page.locator('.composer textarea').press('Enter');
  // Wait until the completed turn leaves Working; that move remounts its row.
  await expect(page.locator('.sidebar nav > .rows .row-main').filter({ hasText: 'Queued title tooltip' })).toBeVisible();
  const row = page.locator('.row-main').filter({ hasText: 'Queued title tooltip' });
  await row.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: /Rename/ }).click();
  const title = 'A complete saved title with enough words to wrap beyond the compact sidebar row and still be readable by keyboard';
  await page.getByRole('textbox', { name: 'Thread title', exact: true }).fill(title);
  await page.getByRole('textbox', { name: 'Thread title', exact: true }).press('Enter');
  const renamed = page.locator('.row-main').filter({ hasText: title });
  // Other journeys share this fixture server and can leave many rows before this one.
  // Filter through the UI so keyboard traversal has a stable starting list.
  const search = page.getByRole('searchbox', { name: 'Search threads', exact: true });
  await search.fill(title);
  await expect(page.locator('.row-main')).toHaveCount(1);
  const before = await renamed.boundingBox();
  await search.focus();
  for (let i = 0; i < 12 && !(await renamed.evaluate(el => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(renamed).toBeFocused();
  const tip = page.getByRole('tooltip');
  await expect(tip).toHaveText(title);
  await expect(tip).toBeInViewport();
  expect((await renamed.boundingBox())?.height).toBe(before?.height);
  // Composer controls carry no tooltip.
  await effort(page).hover();
  await expect(tip.filter({ hasText: 'Effort' })).toHaveCount(0);
  await expect(effort(page)).not.toHaveAttribute('title');
  await page.mouse.move(899, 5);
  await page.getByRole('searchbox', { name: 'Search threads', exact: true }).focus();
  // A long search scrolls its text horizontally; blurring it resets that scroll.
  // That unrelated input scroll must not dismiss the row's keyboard tooltip.
  await expect.poll(() => search.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await renamed.focus();
  await expect.poll(() => search.evaluate(el => el.scrollLeft)).toBe(0);
  await expect(renamed).toBeFocused();
  await expect(tip).toHaveText(title);
  await page.screenshot({ path: info.outputPath('full-title-keyboard.png') });
  await page.keyboard.press('Escape');
  await expect(tip).toHaveCount(0);
  await expect(renamed).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(tip.filter({ hasText: title })).toHaveCount(0);
  const chip = effort(page);
  await chip.focus();
  await expect(tip.filter({ hasText: 'Effort' })).toHaveCount(0);
  await chip.press('Enter');
  await expect(page.getByRole('menu', { name: 'Effort', exact: true })).toBeVisible();
  await expect(tip).toHaveCount(0);
});

test('a restart reopens the draft that was open, with its unsent text', async ({ page, context, baseURL }) => {
  await freshDraft(page, baseURL);
  await page.locator('.composer textarea').fill('Half-written thought');
  await page.close();
  // A new tab starts with empty sessionStorage, as a restarted app does.
  const reopened = await context.newPage();
  await reopened.goto(`${baseURL}/#token=${token}`);
  await expect(reopened.locator('.composer textarea:visible')).toHaveValue('Half-written thought');
  await reopened.locator('.composer textarea:visible').fill('');
});

async function freshDraft(page: Page, baseURL: string | undefined) {
  await page.goto(`${baseURL}/#token=${token}`);
  await page.getByRole('button', { name: 'New thread', exact: true }).first().click();
  await page.getByRole('option', { name: /^No project/ }).click();
  await expect(page.locator('.composer textarea')).toBeVisible();
}

async function threadNamed(baseURL: string | undefined, title: string) {
  const client = await TestClient.open(`${baseURL!.replace('http:', 'ws:')}/ws?token=${token}`);
  try { return (await client.call('threads.list', {})).find(t => t.title === title); }
  finally { client.close(); }
}

test('a fresh draft sends on an immediate Enter', async ({ page, baseURL }) => {
  await freshDraft(page, baseURL);
  const input = page.locator('.composer textarea');
  await input.fill('Queued early enter');
  await input.press('Enter');
  await expect(page.getByText('Finished: Queued early enter', { exact: true })).toBeVisible();
  expect(await threadNamed(baseURL, 'Queued early enter')).toBeDefined();
});

test('High picked from the effort menu in a fresh draft is the new thread’s effort, and survives a reload', async ({ page, baseURL }) => {
  await freshDraft(page, baseURL);
  await effort(page).click();
  await page.getByRole('menuitemradio', { name: 'High', exact: true }).click();
  await expect(effort(page)).toHaveAccessibleName('Effort: High');
  // The menu marks the current level with the model picker's trailing check.
  await effort(page).click();
  await expect(page.getByRole('menuitemradio', { name: 'High', exact: true }).locator('svg')).toHaveCount(1);
  await expect(page.getByRole('menuitemradio', { name: 'Medium', exact: true }).locator('svg')).toHaveCount(0);
  await page.keyboard.press('Escape');
  const input = page.locator('.composer textarea');
  await input.fill('Queued effort from draft');
  await input.press('Enter');
  await expect(page.getByText('Finished: Queued effort from draft', { exact: true })).toBeVisible();
  await expect(effort(page)).toHaveAccessibleName('Effort: High');
  expect((await threadNamed(baseURL, 'Queued effort from draft'))!.model.effort).toBe('high');
  await page.reload();
  await page.locator('.sidebar').getByRole('button', { name: /Queued effort from draft/ }).click();
  await expect(effort(page)).toHaveAccessibleName('Effort: High');
});

test('an effort stepped with the arrow keys is kept when the page reloads at once', async ({ page, baseURL }) => {
  await freshDraft(page, baseURL);
  const input = page.locator('.composer textarea');
  await input.fill('Queued effort reload');
  await input.press('Enter');
  await expect(page.getByText('Finished: Queued effort reload', { exact: true })).toBeVisible();
  await effort(page).focus();
  await page.keyboard.press('ArrowUp');
  const stepped = await effort(page).getAttribute('aria-label');
  expect(stepped).toMatch(/^Effort: (Low|Medium|High)$/);
  await page.reload();
  await page.locator('.sidebar').getByRole('button', { name: /Queued effort reload/ }).click();
  await expect(effort(page)).toHaveAccessibleName(stepped!);
});
