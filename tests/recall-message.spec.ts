import { expect, test } from '@playwright/test';
import { CHAT_TOKEN, newChatDraft } from './chat.js';

test('Up in an empty composer brings back your last message as an ordinary draft', async ({ page, baseURL }, testInfo) => {
  await page.goto(`${baseURL}/#token=${CHAT_TOKEN}`);
  await newChatDraft(page);
  const textarea = page.locator('.composer textarea');

  // A new thread has no sent message: Up leaves the composer empty.
  await textarea.press('ArrowUp');
  await expect(textarea).toHaveValue('');

  const sent = 'Check the flaky test\nin CI';
  await textarea.fill(sent);
  await textarea.press('Enter');
  await expect(page.locator('.msg.user').last()).toContainText('in CI');
  await expect(textarea).toHaveValue('');

  // A draft is never replaced, and modifiers leave Up alone.
  await textarea.fill('my draft');
  await textarea.press('ArrowUp');
  await expect(textarea).toHaveValue('my draft');
  await textarea.fill('');
  await textarea.press('Shift+ArrowUp');
  await textarea.press('Control+ArrowUp');
  await expect(textarea).toHaveValue('');

  // The @ menu keeps Up for moving through it.
  await textarea.pressSequentially('@');
  await expect(page.getByRole('listbox', { name: 'Mention a model, machine or thread' })).toBeVisible();
  await textarea.press('ArrowUp');
  await expect(textarea).toHaveValue('@');
  await textarea.fill('');

  await textarea.press('ArrowUp');
  await expect(textarea).toHaveValue(sent);
  await expect.poll(() => textarea.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd])).toEqual([sent.length, sent.length]);
  await page.locator('.composer').screenshot({ path: testInfo.outputPath('composer-recalled.png') });

  // It is an ordinary draft: it survives a reload and sends edited.
  await textarea.press('End');
  await textarea.pressSequentially(' again');
  await page.reload();
  await expect(textarea).toHaveValue(`${sent} again`);
  await textarea.press('Enter');
  await expect(page.locator('.msg.user').last()).toContainText('in CI again');
  await expect(textarea).toHaveValue('');
  await expect(page.locator('.msg.user')).toHaveCount(2);
});
