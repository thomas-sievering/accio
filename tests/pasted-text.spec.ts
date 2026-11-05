import { expect, test, type Page } from '@playwright/test';

const token = 'isolated-chat-test-token';
const log = Array.from({ length: 200 }, (_, i) => `line ${i + 1}: GET /api/items 500`).join('\n');

/** Pastes text into the composer, as Ctrl+V (or Ctrl+Shift+V) would. Says whether the composer took it over. */
async function pasteText(page: Page, text: string, inline = false): Promise<boolean> {
  return page.locator('.composer textarea').evaluate((el, [text, inline]) => {
    if (inline) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'V', code: 'KeyV', ctrlKey: true, shiftKey: true, bubbles: true }));
    const transfer = new DataTransfer();
    transfer.setData('text/plain', text);
    return !el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, [text, inline] as const);
}

test('a long paste folds into Pasted text, reaches the model whole and shows folded in the thread', async ({ page, baseURL }, testInfo) => {
  await page.goto(`${baseURL}/#token=${token}`);
  await page.locator('.sidebar').getByRole('button', { name: 'New thread', exact: true }).click();
  await page.getByRole('option', { name: 'No project', exact: true }).click();
  if (await page.getByRole('combobox', { name: 'Search profiles' }).isVisible()) await page.getByRole('option', { name: 'Personal', exact: true }).click();
  const textarea = page.locator('.composer textarea');
  const chip = page.locator('.composer-paste');

  // A short paste is left to the textarea; a long one becomes a chip with a hint.
  expect(await pasteText(page, 'just a few words')).toBe(false);
  expect(await pasteText(page, log)).toBe(true);
  await expect(chip).toHaveCount(1);
  await expect(chip).toContainText('200 lines');
  await expect(page.locator('.composer-hint')).toContainText('Ctrl+Shift+V');
  await expect(textarea).toHaveValue('');
  await page.screenshot({ path: testInfo.outputPath('composer-paste.png') });

  // Ctrl+Shift+V keeps a long paste in the box; the chip puts its text back in the message.
  expect(await pasteText(page, log, true)).toBe(false);
  await expect(chip).toHaveCount(1);
  await chip.getByRole('button', { name: /Edit pasted text in the message/ }).click();
  await expect(chip).toHaveCount(0);
  await expect(textarea).toHaveValue(`${log}\n`);
  await textarea.fill('');

  // The chip survives a reload, like the draft text.
  await pasteText(page, log);
  await textarea.fill('What failed?');
  await page.reload();
  await expect(chip).toHaveCount(1);
  await expect(textarea).toHaveValue('What failed?');

  await textarea.press('Enter');
  await expect(page.getByText('Read 200 pasted lines, then: What failed?', { exact: true })).toBeVisible();
  await expect(chip).toHaveCount(0);
  await expect(page.locator('.thread-title, h1').filter({ hasText: 'What failed?' }).first()).toBeVisible();
  const card = page.locator('.msg.user .paste-card');
  await expect(card).toContainText('200 lines');
  await expect(card.locator('.paste-gist')).toHaveText('line 1: GET /api/items 500');
  await expect(card.locator('pre')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('message-paste-folded.png') });
  await card.getByRole('button', { name: /Pasted text/ }).click();
  await expect(card.locator('pre')).toBeVisible();
  await expect(card.locator('pre')).toContainText('line 200: GET /api/items 500');
  await page.locator('.msg.user').first().screenshot({ path: testInfo.outputPath('message-paste-open.png') });

  // Long typed text folds behind "Show full message".
  await textarea.fill(Array.from({ length: 40 }, (_, i) => `step ${i + 1}`).join('\n'));
  await textarea.press('Enter');
  const message = page.locator('.msg.user').last();
  const fold = message.getByRole('button', { name: 'Show full message' });
  await expect(fold).toBeVisible();
  await expect(message.locator('.msg-text')).toHaveClass(/folded/);
  await message.screenshot({ path: testInfo.outputPath('message-folded.png') });
  await fold.click();
  await expect(message.getByRole('button', { name: 'Show less' })).toBeVisible();
  await expect(message.locator('.msg-text')).not.toHaveClass(/folded/);
});
