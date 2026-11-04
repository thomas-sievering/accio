import { expect, test, type Page } from '@playwright/test';

const token = 'isolated-chat-test-token';
const chip = (page: Page) => page.getByRole('button', { name: /^Select model:/ });
const effort = (page: Page) => page.getByRole('button', { name: /^Effort:/ });

async function openThread(page: Page) {
  await page.getByRole('button', { name: /Choice fixture/ }).click();
  await expect(chip(page)).toBeEnabled();
}

test('scrolling over the model chip changes effort; clicking it lists the models', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/#token=${token}`);
  await openThread(page);
  // Claude Code reports no default level, so the lowest step leaves it to Claude Code.
  await expect(effort(page)).toHaveAccessibleName('Effort: Auto');
  await expect(effort(page).locator('.effort-word-current')).toHaveText('auto');
  const initialWidth = (await effort(page).boundingBox())!.width;

  await effort(page).hover();
  await page.mouse.wheel(0, -50);
  await page.mouse.wheel(0, -50);
  await expect(effort(page)).toHaveAccessibleName('Effort: Medium');
  await expect(effort(page).locator('.effort-word-current')).toHaveText('medium');
  expect((await effort(page).boundingBox())!.width).toBe(initialWidth);
  await page.mouse.wheel(0, 50);
  await expect(effort(page)).toHaveAccessibleName('Effort: Low');
  await page.mouse.wheel(0, -50);
  await page.waitForTimeout(800); // Saved once scrolling settles.
  await page.reload();
  await openThread(page);
  await expect(effort(page)).toHaveAccessibleName('Effort: Medium');

  await effort(page).focus();
  await page.keyboard.press('ArrowUp');
  await expect(effort(page)).toHaveAccessibleName('Effort: High');
  await expect(effort(page).locator('.effort-word-current')).toHaveText('high');
  expect(await effort(page).locator('.effort-word').evaluate((el) => el.getAnimations({ subtree: true }).length)).toBeGreaterThan(0);
  await page.waitForTimeout(800);

  // Clicking lists the models and nothing else; another model that accepts the effort keeps it.
  await chip(page).click();
  const list = page.getByRole('dialog', { name: 'Choose a model' });
  await expect(list.getByRole('slider')).toHaveCount(0);
  // It opens on the active provider's list, with the current model focused.
  await expect(list.locator('[data-model-choice][aria-pressed="true"]')).toBeFocused();
  await list.locator('[data-model-choice]', { hasText: 'Sonnet' }).click();
  await expect(chip(page)).toHaveAccessibleName('Select model: Claude Sonnet');
  await expect(effort(page)).toHaveAccessibleName('Effort: High');
  await page.reload();
  await openThread(page);
  await expect(chip(page)).toHaveAccessibleName('Select model: Claude Sonnet');
});

test('effort changes immediately without animation with reduced motion', async ({ page, baseURL }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${baseURL}/#token=${token}`);
  await openThread(page);
  await effort(page).focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown');
  await expect(effort(page).locator('.effort-word-current')).toHaveText('auto');
  await page.keyboard.press('ArrowUp');
  await expect(effort(page).locator('.effort-word-current')).toHaveText('low');
  expect(await effort(page).locator('.effort-word').evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
});
