import { expect, test, type Page } from '@playwright/test';

const token = 'isolated-chat-test-token';
const chip = (page: Page) => page.getByRole('button', { name: /^Effort:/ });

async function openThread(page: Page) {
  await page.getByRole('button', { name: /Choice fixture/ }).click();
  await expect(chip(page)).toBeEnabled();
}

test('steps effort by scrolling over the chip, picks it on the slider, and keeps it across models and reloads', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/#token=${token}`);
  await openThread(page);
  // Claude Code reports no default level, so "Default" is the lowest step.
  await expect(chip(page)).toHaveAccessibleName(/^Effort: Default\./);

  await chip(page).hover();
  await page.mouse.wheel(0, -50);
  await page.mouse.wheel(0, -50);
  await expect(chip(page)).toHaveAccessibleName(/^Effort: Medium\./);
  // Scrolling the other way steps down, and the page itself does not scroll.
  await page.mouse.wheel(0, 50);
  await expect(chip(page)).toHaveAccessibleName(/^Effort: Low\./);
  await page.mouse.wheel(0, -50);
  await expect(chip(page)).toHaveAccessibleName(/^Effort: Medium\./);
  await page.waitForTimeout(800); // The choice is saved once scrolling settles.
  await page.reload();
  await openThread(page);
  await expect(chip(page)).toHaveAccessibleName(/^Effort: Medium\./);

  await chip(page).focus();
  await page.keyboard.press('ArrowUp');
  await expect(chip(page)).toHaveAccessibleName(/^Effort: High\./);

  // Clicking opens a slider that locks into each level; Auto stands for Claude Code's own default.
  await chip(page).click();
  const slider = page.getByRole('dialog', { name: 'Choose effort' }).getByRole('slider', { name: 'Effort' });
  await expect(slider).toBeFocused();
  await expect(page.locator('.effort-ticks button')).toHaveText(['Auto', 'Low', 'Med', 'High', 'XHigh', 'Max']);
  await page.keyboard.press('End');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Max');
  await expect(chip(page)).toHaveAccessibleName(/^Effort: Max\./);
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape');

  // Another model that accepts the level keeps it.
  await page.getByRole('button', { name: /^Select model:/ }).click();
  await page.getByRole('navigation', { name: 'Model groups' }).getByRole('button').nth(1).click();
  await page.locator('[data-model-choice]', { hasText: 'Claude Sonnet' }).click();
  await expect(page.getByRole('button', { name: /^Select model:/ })).toHaveAccessibleName(/Sonnet/);
  await expect(chip(page)).toHaveAccessibleName(/^Effort: Max\./);
  await page.reload();
  await openThread(page);
  await expect(chip(page)).toHaveAccessibleName(/^Effort: Max\./);
  await expect(page.getByRole('button', { name: /^Select model:/ })).toHaveAccessibleName(/Sonnet/);
});
