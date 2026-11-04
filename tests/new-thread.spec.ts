import { expect, test, type Page } from '@playwright/test';
import { TestClient } from '../apps/server/src/testing/testApp.js';

const token = 'isolated-chat-test-token';
const effort = (page: Page) => page.getByRole('button', { name: /^Effort:/ });

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
  await page.getByRole('button', { name: /Queued effort from draft/ }).click();
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
  await page.getByRole('button', { name: /Queued effort reload/ }).click();
  await expect(effort(page)).toHaveAccessibleName(stepped!);
});
