import { expect, test, type Page } from '@playwright/test';

const token = 'isolated-chat-test-token';
const chip = (page: Page) => page.getByRole('button', { name: /^Select model:/ });

async function openThread(page: Page) {
  await page.getByRole('button', { name: /Choice fixture/ }).click();
  await expect(chip(page)).toBeEnabled();
}

test('scrolling over the model chip changes effort; clicking it lists the models', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/#token=${token}`);
  await openThread(page);
  // Claude Code reports no default level, so the lowest step leaves it to Claude Code.
  await expect(chip(page)).toHaveAccessibleName('Select model: Claude Opus · default effort');
  await expect(chip(page).locator('.effort-word-current')).toHaveText('auto');
  const initialWidth = (await chip(page).boundingBox())!.width;

  await chip(page).hover();
  await page.mouse.wheel(0, -50);
  await page.mouse.wheel(0, -50);
  await expect(chip(page)).toHaveAccessibleName('Select model: Claude Opus · Medium effort');
  await expect(chip(page).locator('.effort-word-current')).toHaveText('medium');
  expect((await chip(page).boundingBox())!.width).toBe(initialWidth);
  await page.mouse.wheel(0, 50);
  await expect(chip(page)).toHaveAccessibleName('Select model: Claude Opus · Low effort');
  await page.mouse.wheel(0, -50);
  await page.waitForTimeout(800); // Saved once scrolling settles.
  await page.reload();
  await openThread(page);
  await expect(chip(page)).toHaveAccessibleName('Select model: Claude Opus · Medium effort');

  await chip(page).focus();
  await page.keyboard.press('ArrowUp');
  await expect(chip(page)).toHaveAccessibleName('Select model: Claude Opus · High effort');
  await expect(chip(page).locator('.effort-word-current')).toHaveText('high');
  expect(await chip(page).locator('.effort-word').evaluate((el) => el.getAnimations({ subtree: true }).length)).toBeGreaterThan(0);
  await page.waitForTimeout(800);

  // Clicking lists the models and nothing else; another model that accepts the effort keeps it.
  await chip(page).click();
  const list = page.getByRole('dialog', { name: 'Choose a model' });
  await expect(list.getByRole('slider')).toHaveCount(0);
  await list.getByRole('navigation', { name: 'Model groups' }).getByRole('button').nth(1).click();
  await list.locator('[data-model-choice]', { hasText: 'Claude Sonnet' }).click();
  await expect(chip(page)).toHaveAccessibleName('Select model: Claude Sonnet · High effort');
  await page.reload();
  await openThread(page);
  await expect(chip(page)).toHaveAccessibleName('Select model: Claude Sonnet · High effort');
});

test('effort changes immediately without animation with reduced motion', async ({ page, baseURL }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${baseURL}/#token=${token}`);
  await openThread(page);
  await chip(page).focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown');
  await expect(chip(page).locator('.effort-word-current')).toHaveText('auto');
  await page.keyboard.press('ArrowUp');
  await expect(chip(page).locator('.effort-word-current')).toHaveText('low');
  expect(await chip(page).locator('.effort-word').evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
});
