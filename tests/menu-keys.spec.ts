import { expect, test, type Locator, type Page } from '@playwright/test';
import { chatClient, startProjectThread } from './chat.js';

const token = 'isolated-chat-test-token';

async function openThread(page: Page, baseURL: string | undefined) {
  await page.goto(`${baseURL}/#token=${token}`);
  await page.locator('.sidebar').getByRole('button', { name: /Choice fixture/ }).click();
  await expect(page.getByRole('button', { name: /^Select model:/ })).toBeEnabled();
}

/** Opens on its checked or first item; End, Home and the arrows move and wrap the same way in every menu. */
async function expectMenuKeys(page: Page, popover: Locator, items: Locator, opening: Locator) {
  await expect(popover).toBeVisible();
  await expect(opening).toBeFocused();
  const box = (await popover.boundingBox())!;
  const view = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(view.width);
  expect(box.y + box.height).toBeLessThanOrEqual(view.height);
  const count = await items.count();
  expect(count).toBeGreaterThan(1);
  await page.keyboard.press('End');
  await expect(items.nth(count - 1)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(items.nth(count - 1)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
}

test('every picker and menu opens in the window on its checked item and shares arrow, Home and End keys', async ({ page, baseURL }) => {
  await openThread(page, baseURL);

  await page.getByRole('button', { name: /^Effort:/ }).click();
  const effort = page.getByRole('menu', { name: 'Effort' });
  await expectMenuKeys(page, effort, effort.getByRole('menuitemradio'), effort.getByRole('menuitemradio', { checked: true }));

  await page.getByRole('button', { name: /^Select model:/ }).click();
  const models = page.getByRole('dialog', { name: 'Choose a model' });
  await expectMenuKeys(page, models, models.locator('[data-model-choice]'), models.locator('[data-model-choice][aria-pressed="true"]'));

  await page.getByRole('button', { name: 'Filter threads' }).click();
  const scope = page.getByRole('menu', { name: 'Filter threads' });
  await expectMenuKeys(page, scope, scope.locator('button'), scope.getByRole('menuitemradio', { name: /All threads/ }));

  await page.getByRole('button', { name: 'Thread actions', exact: true }).click();
  const actions = page.getByRole('menu', { name: 'Thread actions' });
  const actionItems = actions.locator('button:not(:disabled)');
  await expectMenuKeys(page, actions, actionItems, actionItems.first());
});

test('the right-click menu opens at the pointer and above it when there is no room below', async ({ page, baseURL }) => {
  await openThread(page, baseURL);
  const row = page.locator('.sidebar').getByRole('button', { name: /Choice fixture/ });
  const rowBox = (await row.boundingBox())!;
  const menu = page.locator('.context-menu');

  await row.click({ button: 'right', position: { x: 20, y: 10 } });
  const items = menu.locator('button:not(:disabled)');
  await expectMenuKeys(page, menu, items, items.first());

  // A window that ends just below the row leaves no room under the pointer.
  await page.setViewportSize({ width: page.viewportSize()!.width, height: Math.ceil(rowBox.y + rowBox.height + 40) });
  await row.click({ button: 'right', position: { x: 20, y: 10 } });
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(rowBox.y + 10 + 1);
  expect(box.y).toBeGreaterThanOrEqual(0);
});

test('the Ship options open above Ship on the chosen mode and share the keys', async ({ page, baseURL }) => {
  await startProjectThread(page, baseURL!, /delivery-project/, 'Build delivery fixture');
  await expect(page.getByText('Feature implemented. Running checks…', { exact: true })).toBeVisible();
  const threadId = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.endsWith(':accio.thread'))?.[1]);
  try {
    await page.getByRole('button', { name: 'Shipping options', exact: true }).click();
    const menu = page.getByRole('menu', { name: 'Shipping options', exact: true });
    await expectMenuKeys(page, menu, menu.getByRole('menuitemradio'), menu.getByRole('menuitemradio', { checked: true }));
  } finally {
    // Its turn would otherwise finish during a later spec and take the top of that spec's inbox.
    const client = await chatClient(baseURL!);
    try { if (threadId) await client.call('threads.stop', { threadId }); } finally { client.close(); }
  }
});
