import { expect, test, type Page } from '@playwright/test';

const token = 'isolated-chat-test-token';
const chip = (page: Page) => page.getByRole('button', { name: /^Select model:/ });
const panel = (page: Page) => page.getByRole('dialog', { name: 'Choose a model' });

async function openThread(page: Page, title: RegExp) {
  await page.getByRole('button', { name: title }).click();
  await expect(chip(page)).toBeEnabled();
}

test('one chip shows the preset level, or the model and effort when the choice is your own', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/#token=${token}`);
  await openThread(page, /Inline chat fixture/);
  // The fixture thread runs Opus with no effort chosen, which no preset stands for.
  await expect(chip(page)).toHaveAccessibleName('Select model: Claude Opus · default effort');
  await expect(chip(page)).toContainText('Opus');

  // Scrolling over the chip steps presets, from the lowest when the choice is your own.
  await chip(page).hover();
  await page.mouse.wheel(0, -50);
  await expect(chip(page)).toHaveText('Low');
  await page.mouse.wheel(0, -50);
  await page.mouse.wheel(0, -50);
  await expect(chip(page)).toHaveText('High');
  await expect(chip(page)).toHaveAccessibleName('Select model: High preset · Claude Opus · High effort');
  await page.waitForTimeout(800); // Saved once scrolling settles.
  await page.reload();
  await openThread(page, /Inline chat fixture/);
  await expect(chip(page)).toHaveText('High');

  // The panel has the preset slider, the models and the effort slider.
  await chip(page).click();
  const preset = panel(page).getByRole('slider', { name: 'Preset' });
  await expect(panel(page).getByRole('region', { name: 'Preset' }).locator('.step-ticks button')).toHaveText(['Low', 'Med', 'High', 'Ultra']);
  // The preset slider has focus on opening, so the arrow keys step presets at once.
  await expect(preset).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(panel(page).getByRole('region', { name: 'Preset' })).toContainText('Claude Sonnet · Medium effort');
  await expect(chip(page)).toHaveText('Medium');
  await page.waitForTimeout(800);

  // Changing the effort by hand makes the choice your own: the chip shows model and meter.
  const effort = panel(page).getByRole('slider', { name: 'Effort' });
  await expect(panel(page).getByRole('region', { name: 'Effort' }).locator('.step-ticks button')).toHaveText(['Auto', 'Low', 'Med', 'High', 'XHigh', 'Max']);
  await effort.focus();
  await page.keyboard.press('End');
  await expect(effort).toHaveAttribute('aria-valuetext', 'Max');
  await page.waitForTimeout(800);
  await expect(chip(page)).toHaveAccessibleName('Select model: Claude Sonnet · Max effort');
  await expect(panel(page).getByRole('slider', { name: 'Preset' })).toHaveAttribute('aria-valuetext', 'Custom');
  await page.keyboard.press('Escape');

  // Another model that accepts the effort keeps it. Without Fable, Opus at max is the Ultra
  // preset, so a choice made by hand that matches a preset shows as that preset.
  await chip(page).click();
  await panel(page).getByRole('navigation', { name: 'Model groups' }).getByRole('button').nth(1).click();
  await panel(page).locator('[data-model-choice]', { hasText: 'Claude Opus' }).click();
  await expect(chip(page)).toHaveAccessibleName('Select model: Ultra preset · Claude Opus · Max effort');
  await page.reload();
  await openThread(page, /Inline chat fixture/);
  await expect(chip(page)).toHaveText('Ultra');
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
