import { expect, test, type Page } from '@playwright/test';
import { chatClient, startProjectThread } from './chat.js';

/** The open thread's delivery as the server holds it. */
async function delivery(page: Page, baseURL: string) {
  const client = await chatClient(baseURL);
  try {
    // The selection this window saved: the thread it shows.
    const id = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.endsWith(':accio.thread'))?.[1]);
    const thread = (await client.call('threads.list', {})).find((t) => t.id === id);
    return { status: thread?.status, mode: thread?.delivery?.mode, delivery: thread?.delivery?.status };
  } finally { client.close(); }
}

test('Ship when done arms by button or Alt+S, follows the mode and ships once the sent turn finishes', async ({ page, baseURL }, testInfo) => {
  test.setTimeout(60_000);
  await startProjectThread(page, baseURL!, /delivery-project/, 'Delivery follow-up');
  await expect(page.getByText('Fresh workspace ready.', { exact: true })).toBeVisible();
  const input = page.locator('.composer textarea');
  const ship = page.getByRole('button', { name: 'Ship', exact: true });
  const chip = page.locator('.composer-ship');
  const removeChip = page.getByRole('button', { name: 'Remove Ship when done', exact: true });

  // With nothing written, Ship ships now and Alt+S does nothing.
  await input.focus();
  await page.keyboard.press('Alt+S');
  await expect(chip).toHaveCount(0);
  await expect(ship).toHaveAttribute('aria-pressed', 'false');

  // While writing, Ship arms the chip instead; clicking the chip removes it.
  await input.fill('Build delivery fixture');
  await ship.click();
  await expect(chip).toHaveText('Ship when done');
  await expect(ship).toHaveAttribute('aria-pressed', 'true');
  await removeChip.click();
  await expect(chip).toHaveCount(0);
  await expect(input).toBeFocused();

  // Alt+S toggles it, and the chip follows the Ship / Prepare for review choice.
  await page.keyboard.press('Alt+S');
  await expect(chip).toHaveText('Ship when done');
  await page.keyboard.press('Alt+S');
  await expect(chip).toHaveCount(0);
  await page.keyboard.press('Alt+S');
  await page.getByRole('button', { name: 'Shipping options', exact: true }).click();
  await page.getByRole('menuitemradio', { name: /Prepare for review/ }).click();
  await expect(chip).toHaveText('Review when done');
  await expect(page.getByRole('button', { name: 'Prepare for review', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Shipping options', exact: true }).click();
  await page.getByRole('menuitemradio', { name: /Ship to main/ }).click();
  await expect(chip).toHaveText('Ship when done');
  await expect(input).toHaveValue('Build delivery fixture');
  await page.locator('.composer').screenshot({ path: testInfo.outputPath('ship-when-done-chip.png') });

  // The chip survives a reload with the draft.
  await page.reload();
  await expect(chip).toHaveText('Ship when done');
  // Like Ship, the chip waits for the workspace check.
  await expect(ship).toBeEnabled();
  await expect(chip).not.toHaveClass(/unavailable/);

  // Sending sends the message, then queues the delivery behind the turn it started.
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Feature implemented. Running checks…', { exact: true })).toBeVisible();
  await expect(chip).toHaveCount(0);
  const actions = page.locator('.delivery-actions');
  await expect(actions.getByText('Ships when done', { exact: true })).toBeVisible();
  await expect.poll(() => delivery(page, baseURL!)).toEqual({ status: 'running', mode: 'ship', delivery: 'queued' });
  await page.screenshot({ path: testInfo.outputPath('ship-when-done-queued.png') });
  await expect(actions.getByRole('status')).toContainText('Shipped to main', { timeout: 30_000 });
  await expect(page.getByText('Ship to main when ready.', { exact: true })).toHaveCount(1);
});

test('Alt+Enter sends and ships in one step; a failed send or an unavailable Ship ships nothing', async ({ page, baseURL }, testInfo) => {
  // The app's calls, with the next send refused when asked.
  const calls: string[] = [];
  let refuseSend = false;
  await page.routeWebSocket('**/ws?*', socket => {
    const server = socket.connectToServer();
    socket.onMessage(message => {
      const call = JSON.parse(String(message)) as { id: number; method: string };
      calls.push(call.method);
      if (refuseSend && call.method === 'threads.send') {
        refuseSend = false;
        socket.send(JSON.stringify({ type: 'response', id: call.id, error: 'Sending failed in this test.' }));
      } else server.send(message);
    });
  });
  await startProjectThread(page, baseURL!, /delivery-project/, 'Delivery follow-up');
  await expect(page.getByText('Fresh workspace ready.', { exact: true })).toBeVisible();
  const input = page.locator('.composer textarea');
  const chip = page.locator('.composer-ship');
  const actions = page.locator('.delivery-actions');

  await expect(page.getByRole('button', { name: 'Ship', exact: true })).toBeEnabled();
  await input.fill('Build delivery fixture');

  // A refused send requests no delivery and leaves the chip armed for the retry.
  await input.press('Alt+S');
  refuseSend = true;
  await input.press('Enter');
  await expect(page.locator('.composer-error')).toHaveText('Sending failed in this test.');
  await expect(chip).toHaveText('Ship when done');
  await expect(input).toHaveValue('Build delivery fixture');
  expect(calls).not.toContain('threads.deliver');
  await input.press('Alt+S');
  await expect(chip).toHaveCount(0);

  // Alt+Enter sends and ships without the chip.
  await input.press('Alt+Enter');
  await expect(page.getByText('Feature implemented. Running checks…', { exact: true })).toBeVisible();
  await expect(input).toHaveValue('');
  await expect(chip).toHaveCount(0);
  await expect(actions.getByText('Ships when done', { exact: true })).toBeVisible();
  await expect.poll(() => delivery(page, baseURL!)).toEqual({ status: 'running', mode: 'ship', delivery: 'queued' });

  // Queued messages hold Ship back, so the chip can't promise one either. Queueing never ships and keeps it armed.
  await actions.getByRole('button', { name: 'Cancel queued delivery' }).click();
  await expect(actions.getByText('Ships when done', { exact: true })).toHaveCount(0);
  await input.fill('Delivery follow-up');
  await input.press('Alt+S');
  await expect(chip).toHaveText('Ship when done');
  await input.press('Control+Enter');
  await expect(page.locator('.queued-message')).toHaveCount(1);
  await input.fill('Wait for the queue');
  await input.press('Enter');
  const removeChip = page.getByRole('button', { name: 'Remove Ship when done', exact: true });
  await expect(chip).toHaveClass(/unavailable/);
  await expect(removeChip).toHaveAttribute('title', 'Send or remove queued messages first');
  await expect(page.locator('.composer-error')).toContainText("Can't ship when done: Send or remove queued messages first.");
  await expect(input).toHaveValue('Wait for the queue');
  await expect(page.getByRole('button', { name: 'Ship', exact: true })).toBeDisabled();
  await page.locator('.composer').screenshot({ path: testInfo.outputPath('ship-when-done-unavailable.png') });
  // The chip still comes off; then Alt+S won't arm what Ship can't do, and Alt+Enter refuses too.
  await removeChip.click();
  await expect(chip).toHaveCount(0);
  await input.press('Alt+S');
  await expect(chip).toHaveCount(0);
  await input.press('Alt+Enter');
  await expect(page.locator('.composer-error')).toContainText("Can't ship when done: Send or remove queued messages first.");
  await expect(chip).toHaveCount(0);
  await input.press('Control+Enter');
  await expect(page.locator('.queued-message')).toHaveCount(2);
  expect((await delivery(page, baseURL!)).delivery).toBeUndefined();
});
