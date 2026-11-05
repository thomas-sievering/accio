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

test('a new thread with something in its composer waits in the inbox as a Draft', async ({ page, baseURL }, testInfo) => {
  await page.goto(`${baseURL}/#token=${token}`);
  await page.locator('.sidebar').getByRole('button', { name: 'New thread', exact: true }).click();
  await page.getByRole('option', { name: /delivery-project/ }).click();
  // The project the thread will run in stands out in the question.
  await expect(page.locator('.hero h1 .hero-project')).toHaveText('delivery-project');
  const drafts = page.locator('.sidebar .row.draft');
  await expect(drafts).toHaveCount(0);
  await pasteImage(page);
  await expect(page.locator('.composer-image')).not.toHaveClass(/uploading/);
  const draft = drafts.filter({ hasText: 'Pasted image' });
  await expect(draft).toContainText('Draft');
  await page.locator('.composer textarea').fill('Draft kept while away\nsecond line');
  await expect(drafts.filter({ hasText: 'Draft kept while away' })).toHaveClass(/active/);
  await page.screenshot({ path: testInfo.outputPath('draft-row.png') });

  // Moving to another thread keeps the draft, image included, and its row opens it again.
  await page.locator('.sidebar').getByRole('button', { name: /Inline chat fixture/ }).click();
  await expect(page.locator('.hero')).toHaveCount(0);
  const row = drafts.filter({ hasText: 'Draft kept while away' });
  await expect(row).not.toHaveClass(/active/);
  await row.locator('.row-main').click();
  await expect(page.locator('.composer textarea')).toHaveValue('Draft kept while away\nsecond line');
  await expect(page.locator('.composer-image')).toHaveCount(1);

  // Sending turns the draft into the thread.
  await page.locator('.composer textarea').press('Enter');
  await expect(page.locator('.msg.user img')).toHaveCount(1);
  await expect(drafts).toHaveCount(0);

  // Discarding a draft from its row empties it.
  await page.locator('.sidebar').getByRole('button', { name: 'New thread', exact: true }).click();
  await page.getByRole('option', { name: /delivery-project/ }).click();
  await page.locator('.composer textarea').fill('Throwaway');
  await drafts.hover();
  await page.getByRole('button', { name: 'Discard draft' }).click();
  await expect(drafts).toHaveCount(0);
  await expect(page.locator('.composer textarea')).toHaveValue('');
});

test('saved message images recover failed grants, reconnects and repeated expiry', async ({ page, baseURL }) => {
  let failGrants = false;
  const disconnect: (() => void)[] = [];
  await page.routeWebSocket('**/ws?*', socket => {
    const server = socket.connectToServer();
    disconnect.push(() => { socket.close(); server.close(); });
    socket.onMessage(message => {
      const request = JSON.parse(String(message));
      if (request.method === 'threads.assetUrl' && failGrants) socket.send(JSON.stringify({ type: 'response', id: request.id, ok: false, error: 'Image grant unavailable' }));
      else server.send(message);
    });
  });
  await page.goto(`${baseURL}/#token=${token}`);
  await page.locator('.sidebar').getByRole('button', { name: 'New thread', exact: true }).click();
  await page.getByRole('option', { name: 'No project', exact: true }).click();
  if (await page.getByRole('combobox', { name: 'Search profiles' }).isVisible()) await page.getByRole('option', { name: 'Personal', exact: true }).click();
  await pasteImage(page);
  await expect(page.locator('.composer-image')).not.toHaveClass(/uploading/);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.msg.user .msg-image img')).toBeVisible();
  await expect(page.locator('.draft-starting')).toHaveCount(0);
  await expect(page.locator('.msg.assistant').last()).toContainText('Saw 1 image.');
  failGrants = true;
  await page.reload();
  await expect(page.locator('.msg-image-missing')).toContainText('Image grant unavailable');
  failGrants = false;
  await page.locator('.msg-image-missing').getByRole('button', { name: 'Retry', exact: true }).click();
  const image = page.locator('.msg.user .msg-image img');
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  const expired = new Set<string>();
  await page.route('**/thread-assets/*', route => expired.has(route.request().url()) ? route.fulfill({ status: 404 }) : route.continue());
  for (let attempt = 0; attempt < 2; attempt++) {
    const old = await image.getAttribute('src');
    const expiredSource = `${old}?expired=${attempt}`;
    expired.add(expiredSource);
    // A distinct request avoids Chromium's decoded-image cache when simulating expiry.
    await image.evaluate((img: HTMLImageElement, src) => { img.src = src; }, expiredSource);
    await expect.poll(async () => { const src = await image.getAttribute('src'); return src !== old && !expired.has(src!); }).toBe(true);
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  }
  // An error on a remount must retry itself when the same connection opens again.
  failGrants = true;
  await page.reload();
  await expect(page.locator('.msg-image-missing')).toContainText('Image grant unavailable');
  failGrants = false;
  disconnect.splice(0).forEach(close => close());
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
});
