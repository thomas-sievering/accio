import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const token = 'isolated-chat-test-token';

/** Pastes a PNG into the composer, as copying a screenshot would. */
async function pasteImage(page: Page) {
  const data = (await readFile(resolve('tests/fixtures/chat.png'))).toString('base64');
  await page.locator('.composer textarea').evaluate((textarea, data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
    textarea.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, data);
}

test('a pasted image starts a thread, shows in the message and opens full size', async ({ page, baseURL }, testInfo) => {
  await page.goto(`${baseURL}/#token=${token}`);
  await page.locator('.sidebar').getByRole('button', { name: 'New thread', exact: true }).click();
  await page.getByRole('option', { name: 'No project', exact: true }).click();
  if (await page.getByRole('combobox', { name: 'Search profiles' }).isVisible()) await page.getByRole('option', { name: 'Personal', exact: true }).click();
  await pasteImage(page);
  const chip = page.locator('.composer-image');
  await expect(chip).toHaveCount(1);
  await expect(chip).not.toHaveClass(/uploading/);
  await page.screenshot({ path: testInfo.outputPath('composer-image.png') });
  // Removing it leaves nothing to send; pasting again brings it back.
  await chip.hover();
  await page.getByRole('button', { name: 'Remove Pasted image' }).click();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await pasteImage(page);
  await expect(chip).not.toHaveClass(/uploading/);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Saw 1 image.', { exact: true })).toBeVisible();
  await expect(page.locator('.composer-image')).toHaveCount(0);
  const thumbnail = page.locator('.msg.user .msg-image img');
  await expect(thumbnail).toBeVisible();
  await expect.poll(() => thumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath('message-image.png') });
  await page.getByRole('button', { name: 'Expand image: Pasted image' }).click();
  await expect(page.locator('dialog.image-viewer img')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog.image-viewer')).toHaveCount(0);

  // A follow-up carries text and the image together; both survive a reload.
  await page.locator('.composer textarea').fill('And this one');
  await pasteImage(page);
  await expect(page.locator('.composer-image')).not.toHaveClass(/uploading/);
  await page.locator('.composer textarea').press('Enter');
  await expect(page.locator('.msg.user').last()).toContainText('And this one');
  await expect(page.locator('.msg.user').last().locator('.msg-image img')).toBeVisible();
  await page.reload();
  await expect(page.locator('.msg.user .msg-image img')).toHaveCount(2);
});
