import { expect, test } from '@playwright/test';

const token = 'isolated-chat-test-token';

test('a /goal keeps the thread working with a status bar until the harness reports it achieved', async ({ page, baseURL }, testInfo) => {
  await page.goto(`${baseURL}/#token=${token}`);
  await page.getByRole('button', { name: /Goal fixture/ }).click();
  const bar = page.getByRole('region', { name: 'Goal' });
  await expect(bar).toHaveCount(0);

  // Setting a goal: the bar appears, and accio starts the following turns itself.
  await page.locator('.composer textarea').fill('/goal fixture: make the checks pass');
  await page.keyboard.press('Enter');
  await expect(bar).toContainText('fixture: make the checks pass');
  await expect(bar).toContainText('working');
  await expect(bar.getByRole('button', { name: 'Pause goal' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('goal-active.png') });
  await expect(bar).toContainText('achieved · Fixture verified');
  await expect(page.locator('.goal-continue')).toHaveCount(2);
  await expect(page.locator('.msg.user').filter({ hasText: '/goal fixture: make the checks pass' })).toHaveCount(1);
  await expect(page.getByText('Goal turn 3.')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('goal-achieved.png') });
  await bar.getByRole('button', { name: 'Clear goal' }).click();
  await expect(bar).toHaveCount(0);

  // Blocked pauses with the reason; Resume continues; the harness then finishes.
  await page.locator('.composer textarea').fill('/goal blocked fixture: deploy');
  await page.keyboard.press('Enter');
  await expect(bar).toContainText('paused · Need the fixture token');
  await page.screenshot({ path: testInfo.outputPath('goal-paused.png') });
  await bar.getByRole('button', { name: 'Resume goal' }).click();
  await expect(bar).toContainText('achieved · Fixture verified');

  // The command form works too.
  await page.locator('.composer textarea').fill('/goal clear');
  await page.keyboard.press('Enter');
  await expect(bar).toHaveCount(0);
});
