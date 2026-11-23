import { expect, test } from '@playwright/test';
import { CHAT_TOKEN, chatClient } from './chat.js';

const viewport = { width: 390, height: 844 };

test.describe('phone touch layout', () => {
  test.use({ viewport, hasTouch: true, isMobile: true });

  test('pushes between inbox and threads, keeps drafts, and sends from the composer', async ({ page, baseURL }, info) => {
    const client = await chatClient(baseURL!);
    try {
      const thread = await client.call('threads.start', { profileId: 'personal', text: 'Queued phone layout fixture' });
      await client.waitFor('threads.changed', (threads) => threads.some((entry) => entry.id === thread.id && entry.status === 'idle'));
    } finally {
      client.close();
    }
    await page.goto(`${baseURL}/#token=${CHAT_TOKEN}`);
    const inbox = page.locator('.sidebar');
    const row = inbox.locator('.row-main').filter({ hasText: 'Queued phone layout fixture' });
    const otherRow = inbox.locator('.row-main').filter({ hasText: 'Needs you thread' });
    const back = page.getByRole('button', { name: 'Inbox', exact: true });
    const composer = page.locator('.composer textarea');
    await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
    await expect(page.getByRole('main')).toBeHidden();
    await row.tap();
    await expect(back).toBeVisible();
    await expect(inbox).toBeHidden();
    await expect(page.locator('.thread-machine')).not.toBeEmpty();

    const model = page.getByRole('button', { name: /^Select model:/ });
    await model.tap();
    const picker = page.getByRole('dialog', { name: 'Choose a model' });
    await expect(picker).toBeVisible();
    await expect.poll(async () => {
      const panel = (await picker.boundingBox())!;
      const trigger = (await model.boundingBox())!;
      return panel.x >= 0 && panel.x + panel.width <= viewport.width && panel.y + panel.height < trigger.y;
    }).toBe(true);
    await picker.locator('[data-model-choice]', { hasText: 'Sonnet' }).tap();
    await expect(model).toHaveAccessibleName('Select model: Claude Sonnet');

    await composer.fill('Projects fixture: add');
    await back.tap();
    await otherRow.tap();
    await expect(composer).toHaveValue('');
    await back.tap();
    await row.tap();
    await expect(composer).toHaveValue('Projects fixture: add');
    await page.getByRole('button', { name: 'Send', exact: true }).tap();
    await expect(page.locator('.msg.user').last()).toHaveText('Projects fixture: add');
    const confirmation = page.getByRole('region', { name: 'Needs your answer: Add 2 projects?' });
    await expect(confirmation).toBeVisible();
    await expect(composer).toHaveValue('');
    await back.tap();
    await expect(row).toContainText('Needs your OK');
    await expect(row).toBeFocused();
    await expect(row).toBeInViewport();
    await page.screenshot({ path: info.outputPath('phone-inbox.png'), animations: 'disabled' });

    await row.tap();
    await expect(confirmation).toBeInViewport();
    await page.screenshot({ path: info.outputPath('phone-thread.png'), animations: 'disabled' });
    const decline = confirmation.getByRole('button', { name: 'Decline' });
    expect((await decline.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await decline.tap();
    await expect(page.getByRole('region', { name: 'Add 2 projects?', exact: true })).toContainText('Declined');
  });
});

test('a narrow desktop uses the same layout and a wide one keeps both panes', async ({ page, baseURL }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize(viewport);
  await page.goto(`${baseURL}/#token=${CHAT_TOKEN}`);
  const inbox = page.locator('.sidebar');
  const back = page.getByRole('button', { name: 'Inbox', exact: true });
  await inbox.locator('.row-main').filter({ hasText: 'Needs you thread' }).click();
  await expect(inbox).toBeHidden();
  await expect(back).toBeVisible();
  expect(await page.locator('html').evaluate((root) => root.matches(':active-view-transition'))).toBe(false);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(inbox).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
  await expect(back).toHaveCount(0);
  await page.setViewportSize(viewport);
  await back.click();
  await expect(inbox).toBeVisible();
  await expect(page.getByRole('main')).toBeHidden();
});
