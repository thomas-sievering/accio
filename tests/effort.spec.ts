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
  // Claude Code reports no default level, so "Auto" is the lowest step.
  await expect(chip(page)).toHaveAccessibleName(/^Effort: Auto\./);

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
  await expect(page.getByRole('dialog', { name: 'Choose effort' }).locator('.step-ticks button')).toHaveText(['Auto', 'Low', 'Med', 'High', 'XHigh', 'Max']);
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

test('steps through presets, which set model and effort together and never leave the harness', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/#token=${token}`);
  await page.getByRole('button', { name: /Inline chat fixture/ }).click();
  const preset = page.getByRole('button', { name: /^Preset:/ });
  const model = page.getByRole('button', { name: /^Select model:/ });
  await expect(preset).toBeEnabled();
  // The fixture thread runs Opus with no effort chosen, which no preset stands for.
  await expect(preset).toHaveAccessibleName(/^Preset: Custom\./);

  await preset.hover();
  await page.mouse.wheel(0, -50);
  await expect(preset).toHaveAccessibleName(/^Preset: Low\./);
  await page.mouse.wheel(0, -50);
  await page.mouse.wheel(0, -50);
  await expect(preset).toHaveAccessibleName(/^Preset: High\./);
  await page.waitForTimeout(800);
  await expect(model).toHaveAccessibleName(/Opus/);
  // The preset names the level, so the effort chip shows its meter alone.
  await expect(chip(page)).toHaveAccessibleName(/^Effort: High\./);
  await expect(chip(page)).not.toContainText('High');

  await preset.click();
  const slider = page.getByRole('dialog', { name: 'Choose preset' });
  await expect(slider.locator('.step-ticks button')).toHaveText(['Low', 'Med', 'High', 'Ultra']);
  await page.keyboard.press('ArrowLeft');
  await expect(slider.locator('.step-picker-detail')).toHaveText('Claude Sonnet · Medium effort');
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape');
  await expect(model).toHaveAccessibleName(/Sonnet/);
  await page.reload();
  await page.getByRole('button', { name: /Inline chat fixture/ }).click();
  await expect(page.getByRole('button', { name: /^Preset:/ })).toHaveAccessibleName(/^Preset: Medium\./);

  // Changing the effort by hand leaves the presets: the choice is now your own.
  await chip(page).focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('button', { name: /^Preset:/ })).toHaveAccessibleName(/^Preset: Custom\./, { timeout: 3000 });
});

test('sets a preset level in settings, keeps it across reloads and resets it', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/#token=${token}`);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('.sidebar nav').getByRole('button', { name: 'Harnesses' }).click();
  const model = page.getByRole('combobox', { name: 'Ultra preset model' }).first();
  await expect(model).toHaveValue('opus');
  await model.selectOption({ label: 'Claude Sonnet' });
  const effort = page.getByRole('combobox', { name: 'Ultra preset effort' }).first();
  await expect(effort).toHaveValue('max');
  await effort.selectOption('xhigh');
  await expect(page.getByRole('button', { name: 'Reset' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('.sidebar nav').getByRole('button', { name: 'Harnesses' }).click();
  await expect(page.getByRole('combobox', { name: 'Ultra preset effort' }).first()).toHaveValue('xhigh');
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(page.getByRole('combobox', { name: 'Ultra preset model' }).first()).toHaveValue('opus');
});
