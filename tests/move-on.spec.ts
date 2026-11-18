import { expect, test, type Page } from '@playwright/test';
import { CHAT_TOKEN, chatClient, startProjectThread } from './chat.js';

// GLOSSARY: Move on. The other chat specs turn it off (playwright.config.ts); these run with the default.
test.use({ storageState: { cookies: [], origins: [] } });

/** Starts idle threads without a project, oldest first, and returns their ids by text. */
async function startThreads(baseURL: string, texts: string[]) {
  const client = await chatClient(baseURL);
  const ids: Record<string, string> = {};
  try {
    for (const text of texts) {
      const started = await client.call('threads.start', { profileId: 'personal', text });
      await client.waitFor('threads.changed', (threads) => threads.some((t) => t.id === started.id && t.status === 'idle'));
      ids[text] = started.id;
    }
  } finally { client.close(); }
  return ids;
}

/** Stops the steering fixture's turns, so later specs find these threads idle. */
async function stopThreads(baseURL: string, ids: string[]) {
  const client = await chatClient(baseURL);
  try { for (const threadId of ids) await client.call('threads.stop', { threadId }).catch(() => {}); } finally { client.close(); }
}

/** Opens the app with the sidebar narrowed to this test's threads, so the inbox holds only them. */
async function openInbox(page: Page, baseURL: string, tag: string) {
  await page.goto(`${baseURL}/#token=${CHAT_TOKEN}`);
  await page.locator('.side-search input').fill(tag);
}

// A row sliding to another shelf is briefly drawn twice; either copy names the open thread.
const openRow = (page: Page) => page.locator('.sidebar .row-main[aria-current="page"]').first();
const rowButton = (page: Page, title: string) => page.locator('.sidebar').getByRole('button', { name: new RegExp(title) });

/** The composer has focus, with the cursor at the end of what it holds. */
async function expectCursorAtEnd(page: Page) {
  const textarea = page.locator('.composer textarea');
  await expect(textarea).toBeFocused();
  await expect.poll(() => textarea.evaluate((el: HTMLTextAreaElement) => el.selectionStart === el.value.length && el.selectionEnd === el.value.length)).toBe(true);
}

test('a send that starts a turn moves on to the top of the inbox, then to the empty page, which a reload keeps', async ({ page, baseURL }, testInfo) => {
  const tag = `Move on ${Date.now()}`;
  const [a, b, c] = [`${tag} alpha`, `${tag} bravo`, `${tag} charlie`];
  const ids = await startThreads(baseURL!, [a, b, c]);
  try {
    await openInbox(page, baseURL!, tag);
    const textarea = page.locator('.composer textarea');
    // A half-written prompt in charlie, the top of the inbox.
    await rowButton(page, c).click();
    await textarea.fill('half-written prompt');
    await rowButton(page, a).click();
    await expect(openRow(page)).toContainText(a);

    // Sending from alpha opens charlie, the top of the inbox, its draft kept with the cursor after it.
    await textarea.fill('Steering fixture');
    await textarea.press('Enter');
    await expect(openRow(page)).toContainText(c);
    await expect(textarea).toHaveValue('half-written prompt');
    await expectCursorAtEnd(page);
    await page.screenshot({ path: testInfo.outputPath('moved-on.png') });

    // Charlie's send opens bravo; bravo's, with nothing left in the inbox, opens the empty page.
    await textarea.fill('Steering fixture');
    await textarea.press('Enter');
    await expect(openRow(page)).toContainText(b);
    await expectCursorAtEnd(page);
    await textarea.fill('Steering fixture');
    await textarea.press('Enter');
    const empty = page.getByRole('region', { name: 'Empty page' });
    await expect(empty).toBeVisible();
    await expect(openRow(page)).toHaveCount(0);
    await expect(page.locator('.composer')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('empty-page.png') });

    // The empty page is a selection of its own: a reload stays on it, not on a thread or the idle page.
    await page.reload();
    await expect(empty).toBeVisible();
    await expect(page.getByText('Pick a thread, or start a new one.')).toHaveCount(0);
    await expect(openRow(page)).toHaveCount(0);
  } finally { await stopThreads(baseURL!, Object.values(ids)); }
});

test('steering and queueing stay in the thread, and with Move on off a send that starts a turn stays too', async ({ page, baseURL }) => {
  const tag = `Stay ${Date.now()}`;
  const [steered, other, later] = [`${tag} steered`, `${tag} other`, `${tag} later`];
  const ids = await startThreads(baseURL!, [steered, other, later]);
  const client = await chatClient(baseURL!);
  try {
    await client.call('threads.send', { threadId: ids[steered]!, text: 'Steering fixture' });
    await client.waitFor('threads.changed', (threads) => threads.some((t) => t.id === ids[steered] && t.status === 'running'));
  } finally { client.close(); }
  try {
    await openInbox(page, baseURL!, tag);
    const textarea = page.locator('.composer textarea');
    await rowButton(page, steered).click();
    await expect(page.getByText('Waiting for steering.', { exact: true })).toBeVisible();

    // Enter steers the running turn and Ctrl+Enter queues; neither moves on, though the inbox has threads.
    await textarea.fill('Use the existing helper');
    await textarea.press('Enter');
    await expect(page.getByText('Steered: Use the existing helper', { exact: true })).toBeVisible();
    await expect(openRow(page)).toContainText(steered);
    await textarea.fill('Queued after the turn');
    await textarea.press('Control+Enter');
    await expect(page.getByRole('region', { name: 'Queued messages' })).toContainText('Queued after the turn');
    await expect(openRow(page)).toContainText(steered);
    await expect(textarea).toBeFocused();

    // Settings / Sending turns Move on off: a send that starts a turn then keeps you in the thread.
    await page.locator('.sidebar').getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Sending', exact: true }).click();
    const toggle = page.getByRole('switch', { name: 'Move on after sending' });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await page.keyboard.press('Escape');
    await rowButton(page, other).click();
    await textarea.fill('Steering fixture');
    await textarea.press('Enter');
    await expect(page.getByText('Waiting for steering.', { exact: true })).toBeVisible();
    await expect(openRow(page)).toContainText(other);

    // The switch is this client's preference: it survives a reload.
    await page.reload();
    await page.locator('.sidebar').getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Sending', exact: true }).click();
    await expect(page.getByRole('switch', { name: 'Move on after sending' })).not.toBeChecked();
  } finally { await stopThreads(baseURL!, Object.values(ids)); }
});

test('moving on keeps Ship when done: Alt+Enter sends, ships and opens the next thread', async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  // A project thread with a workspace, opened with Move on off (once per tab), then another inbox thread to move on to.
  await page.addInitScript(() => { if (!sessionStorage.getItem('moveOnSet')) { localStorage.setItem('accio.moveOn', '0'); sessionStorage.setItem('moveOnSet', '1'); } });
  await startProjectThread(page, baseURL!, /delivery-project/, 'Delivery follow-up');
  await expect(page.getByText('Fresh workspace ready.', { exact: true })).toBeVisible();
  const shipped = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.endsWith(':accio.thread'))?.[1]);
  const tag = `Ship on ${Date.now()}`;
  const ids = await startThreads(baseURL!, [tag]);
  try {
    // Move on back on, as by default.
    await page.evaluate(() => localStorage.removeItem('accio.moveOn'));
    await page.reload();
    const input = page.locator('.composer textarea');
    await expect(page.getByRole('button', { name: 'Ship', exact: true })).toBeEnabled();
    await input.fill('Build delivery fixture');
    await input.press('Alt+Enter');
    await expect(openRow(page)).toContainText(tag);
    await expect(page.locator('.composer textarea')).toBeFocused();
    const client = await chatClient(baseURL!);
    try {
      await expect.poll(async () => (await client.call('threads.list', {})).find((t) => t.id === shipped)?.delivery?.mode, { timeout: 15_000 }).toBe('ship');
    } finally { client.close(); }
  } finally { await stopThreads(baseURL!, Object.values(ids)); }
});

test('Ship with nothing written ships and moves on to the next thread', async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => { if (!sessionStorage.getItem('moveOnSet')) { localStorage.setItem('accio.moveOn', '0'); sessionStorage.setItem('moveOnSet', '1'); } });
  await startProjectThread(page, baseURL!, /delivery-project/, 'Delivery follow-up');
  await expect(page.getByText('Fresh workspace ready.', { exact: true })).toBeVisible();
  const shipped = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.endsWith(':accio.thread'))?.[1]);
  const tag = `Ship button ${Date.now()}`;
  const ids = await startThreads(baseURL!, [tag]);
  try {
    await page.evaluate(() => localStorage.removeItem('accio.moveOn'));
    await page.reload();
    await page.getByRole('button', { name: 'Ship', exact: true }).click();
    await expect(openRow(page)).toContainText(tag);
    const client = await chatClient(baseURL!);
    try {
      await expect.poll(async () => (await client.call('threads.list', {})).find((t) => t.id === shipped)?.delivery?.mode, { timeout: 15_000 }).toBe('ship');
    } finally { client.close(); }
  } finally { await stopThreads(baseURL!, Object.values(ids)); }
});

test('Alt+S with nothing written, focus anywhere in the thread, ships and moves on', async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => { if (!sessionStorage.getItem('moveOnSet')) { localStorage.setItem('accio.moveOn', '0'); sessionStorage.setItem('moveOnSet', '1'); } });
  await startProjectThread(page, baseURL!, /delivery-project/, 'Delivery follow-up');
  await expect(page.getByText('Fresh workspace ready.', { exact: true })).toBeVisible();
  const shipped = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.endsWith(':accio.thread'))?.[1]);
  const tag = `Alt S ${Date.now()}`;
  const ids = await startThreads(baseURL!, [tag]);
  try {
    await page.evaluate(() => localStorage.removeItem('accio.moveOn'));
    await page.reload();
    await expect(page.getByRole('button', { name: 'Ship', exact: true })).toBeEnabled();
    // Focus on the transcript, not the composer.
    await page.getByText('Fresh workspace ready.', { exact: true }).click();
    await page.keyboard.press('Alt+S');
    await expect(openRow(page)).toContainText(tag);
    const client = await chatClient(baseURL!);
    try {
      await expect.poll(async () => (await client.call('threads.list', {})).find((t) => t.id === shipped)?.delivery?.mode, { timeout: 15_000 }).toBe('ship');
    } finally { client.close(); }
  } finally { await stopThreads(baseURL!, Object.values(ids)); }
});
