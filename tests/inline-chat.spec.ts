import { expect, test, _electron, type Page, type ElectronApplication } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const token = 'isolated-chat-test-token';

test('Enter steers, Ctrl changes Send and queues; queued edits are held until saved', async ({ page, baseURL }, testInfo) => {
  await page.goto(`${baseURL}/#token=${token}`);
  await page.getByRole('button', { name: /Inline chat fixture/ }).click();
  const input = page.locator('.composer textarea');
  await input.fill('Steering fixture'); await input.press('Enter');
  await expect(page.getByText('Waiting for steering.', { exact: true })).toBeVisible();
  await expect(page.locator('.composer').getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await input.fill('Use the existing helper');
  const normalColor = await page.getByRole('button', { name: 'Send', exact: true }).evaluate(el => getComputedStyle(el).backgroundColor);
  await page.keyboard.down('Control');
  const queueSend = page.getByRole('button', { name: 'Queue message', exact: true });
  await expect(queueSend).toHaveClass('send queue');
  expect(await queueSend.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(normalColor);
  await page.screenshot({ path: testInfo.outputPath('ctrl-queue.png') });
  await page.keyboard.up('Control');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).not.toHaveClass(/queue/);
  await input.press('Enter');
  await expect(page.getByText('Steered: Use the existing helper', { exact: true })).toBeVisible();
  await expect(page.getByText('Steered mid-turn', { exact: true })).toBeVisible();

  await input.fill('Queued first'); await input.press('Control+Enter');
  const tray = page.getByRole('region', { name: 'Queued messages' });
  await expect(tray).toContainText('Queued first');
  await input.fill('Queued second');
  await page.getByRole('button', { name: 'Send', exact: true }).click({ modifiers: ['Control'] });
  await expect(tray.locator('.queued-message')).toHaveCount(2);
  await tray.getByRole('button', { name: 'Steer now', exact: true }).first().click();
  await expect(page.getByText('Steered: Queued first', { exact: true })).toBeVisible();
  await tray.getByRole('button', { name: 'Edit', exact: true }).click();
  await tray.getByRole('textbox', { name: 'Edit queued message' }).fill('Queued edited');
  await input.fill('Queued remove me');
  await page.getByRole('button', { name: /^Queue Ctrl/ }).click();
  await tray.getByRole('button', { name: 'Remove queued message' }).click();
  await input.fill('Finish steering fixture'); await input.press('Enter');
  await expect(page.locator('.composer .stop')).toHaveCount(0);
  await expect(tray.getByRole('textbox')).toHaveValue('Queued edited');
  await expect(page.getByText('Finished: Queued edited', { exact: true })).toHaveCount(0);
  await tray.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Finished: Queued edited', { exact: true })).toBeVisible();
  await expect(tray).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: /Inline chat fixture/ }).click();
  await expect(page.getByText('Steered: Use the existing helper', { exact: true })).toBeVisible();
});
async function openChat(page: Page, baseURL: string, navigate = true) {
  if (navigate) await page.goto(`${baseURL}/#token=${token}`);
  await page.getByRole('button', { name: /Inline chat fixture/ }).click();
  await expect(page.getByAltText('Saved picture')).toBeAttached();
}

async function mediaAndTools(page: Page, desktop?: ElectronApplication) {
  // A completed turn folds its tool calls under "Worked for"; a failure is flagged on the fold.
  const work = page.locator('.turn-work').first();
  await expect(work.locator('.turn-work-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(work.locator('.turn-work-failed')).toHaveText('1 failed');
  await expect(work.locator('.tool')).toHaveCount(0);
  await work.locator('.turn-work-toggle').click();
  const success = page.locator('.tool.done').first();
  const failed = page.locator('.tool.error').first();
  await expect(success.locator('.tool-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(failed.locator('.tool-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(failed).toContainText('Expected fixture failure');
  await success.locator('.tool-toggle').click();
  await expect(success).toContainText('FULL_OUTPUT_TAIL');
  await expect(success).toContainText('file_path');
  const parts = await success.locator('[aria-label="Tool result"]').evaluate((element) => Array.from(element.children).map((entry) => entry.tagName));
  expect(parts).toEqual(['DIV', 'PRE', 'SPAN', 'PRE']);
  await expect(success.getByAltText('media.png')).toBeVisible();
  await success.locator('.tool-toggle').click();
  await expect(success.locator('img')).toHaveCount(0);

  const picture = page.getByAltText('Saved picture');
  await picture.scrollIntoViewIfNeeded();
  await expect.poll(() => picture.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(160);
  for (const label of ['Space picture', 'Unicode picture', 'Literal percent picture', 'Absolute picture']) {
    const image = page.getByAltText(label);
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(160);
  }
  await page.getByRole('button', { name: 'Expand image: Saved picture' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Expand image: Saved picture' })).toBeFocused();
  await expect(page.getByText('Missing picture', { exact: true })).toBeVisible();
  await expect(page.getByAltText('Missing picture')).toHaveCount(0);

  for (const [tag, label] of [['video', 'Demo clip'], ['audio', 'Demo sound']] as const) {
    const player = page.locator(`${tag}[aria-label="${label}"]`);
    await player.scrollIntoViewIfNeeded();
    await expect.poll(() => player.evaluate((element: HTMLMediaElement) => element.readyState)).toBeGreaterThanOrEqual(1);
    await expect(player).toHaveAttribute('controls', '');
    await expect(player).not.toHaveAttribute('autoplay');
    await player.evaluate(async (element: HTMLMediaElement) => { element.currentTime = 1; await element.play(); });
    await expect.poll(() => player.evaluate((element: HTMLMediaElement) => element.currentTime)).toBeGreaterThan(1.05);
    await player.evaluate((element: HTMLMediaElement) => { element.pause(); element.currentTime = 1.2; });
    await expect.poll(() => player.evaluate((element: HTMLMediaElement) => Math.abs(element.currentTime - 1.2))).toBeLessThan(0.15);
  }
  const video = page.locator('video');
  // Simulate two separated expired grants; successful playback resets the automatic retry budget.
  const failedUrls = new Set<string>();
  await page.route('**/thread-assets/*', (route) => failedUrls.has(route.request().url()) ? route.fulfill({ status: 404 }) : route.continue());
  for (let attempt = 0; attempt < 2; attempt++) {
    const oldSource = await video.evaluate((element: HTMLVideoElement) => element.currentSrc);
    failedUrls.add(oldSource);
    await video.evaluate((element: HTMLVideoElement) => element.load());
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentSrc)).not.toBe(oldSource);
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(3);
  }
  await page.unroute('**/thread-assets/*');
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 1.2; });
  await video.evaluate((element) => { (window as any).__savedVideo = element; });
  const streams = await page.getByText(/Stream complete/).count();
  await page.locator('textarea').fill('stream update');
  await page.locator('textarea').press('Enter');
  await expect(page.getByText(/Stream complete/)).toHaveCount(streams + 1);
  await expect(page.getByText(/Stream complete/).last()).toBeVisible();
  expect(await video.evaluate((element) => (window as any).__savedVideo === element)).toBe(true);
  expect(await video.evaluate((element: HTMLVideoElement) => Math.abs(element.currentTime - 1.2))).toBeLessThan(0.15);
  await expect(failed.locator('.tool-toggle')).toHaveAttribute('aria-expanded', 'true');
  await failed.locator('.tool-toggle').click();
  const updates = await page.getByText('Update complete', { exact: true }).count();
  await page.locator('textarea').fill('append update');
  await page.locator('textarea').press('Enter');
  await expect(page.getByText('Update complete', { exact: true })).toHaveCount(updates + 1);
  await expect(page.getByText('Update complete', { exact: true }).last()).toBeVisible();
  await expect(failed.locator('.tool-toggle')).toHaveAttribute('aria-expanded', 'false');
  for (const [label, name, content] of [['Current notes', 'notes.txt', 'The current notes file.'], ['Space notes', 'my notes.txt', 'Notes with spaces.']]) {
    if (desktop) {
      const count = await desktop.evaluate(({ app }) => (app as any).chatDownloads.length);
      await page.getByRole('button', { name: label, exact: true }).click();
      await expect.poll(() => desktop.evaluate(({ app }) => (app as any).chatDownloads.length)).toBe(count + 1);
      const downloaded = await desktop.evaluate(({ app }) => (app as any).chatDownloads.at(-1));
      expect(downloaded).toMatchObject({ name, state: 'completed' });
      expect(await readFile(downloaded.path, 'utf8')).toBe(content);
    } else {
      const downloaded = page.waitForEvent('download');
      await page.getByRole('button', { name: label, exact: true }).click();
      const file = await downloaded;
      expect(file.suggestedFilename()).toBe(name);
      expect(await readFile((await file.path())!, 'utf8')).toBe(content);
    }
  }
}

test('web chat replays snapshots, full ordered tool details and playable stable media', async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openChat(page, baseURL!);
  await mediaAndTools(page);
  await page.reload();
  await page.getByAltText('Saved picture').scrollIntoViewIfNeeded();
  await expect.poll(() => page.getByAltText('Saved picture').evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(160);
  await page.locator('.messages').evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: test.info().outputPath('chat.png') });
  expect(errors).toEqual([]);
});

test('a running turn shows one status line of what it is doing, then folds under Worked for', async ({ page, baseURL }) => {
  await openChat(page, baseURL!);
  // Inside a fold, calls sit bare on the rail; the failed one opens itself.
  const fixture = page.locator('.turn-work').first();
  await fixture.locator('.turn-work-toggle').click();
  await expect(fixture.locator('.tool-group-toggle')).toHaveCount(0);
  await expect(fixture.locator('.tool')).toHaveCount(2);
  await expect(fixture.locator('.tool.error .tool-toggle')).toHaveAttribute('aria-expanded', 'true');

  await page.locator('textarea').fill('explore tools');
  await page.locator('textarea').press('Enter');
  const live = page.locator('.turn-work.live');
  const status = live.getByRole('status');
  await expect(status).toHaveText('Running ls -la');
  await expect(live.locator('.turn-work-elapsed')).toHaveText(/^(<1s|\d+s)$/);
  await expect(live.locator('.tool')).toHaveCount(0);
  await expect(status).toHaveText('Reading README.md');
  // Opening it while running shows the steps so far, and it stays open once the turn completes.
  await live.locator('.turn-work-toggle').click();
  await expect(live.locator('.tool.done').first()).toBeVisible();
  await expect(status).toHaveText('Searching TODO');

  await expect(page.getByText('Explored the folder.')).toBeVisible();
  await expect(live).toHaveCount(0);
  const work = page.locator('.turn-work').last();
  await expect(work.locator('.turn-work-toggle')).toHaveText(/^Worked for \d+s$/);
  await expect(work.locator('.turn-work-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(work.locator('.tool.done')).toHaveCount(3);
  await expect(work.locator('.tool-summary')).toHaveText(['ls -la', 'README.md', 'TODO']);
  await expect(work.getByText('Explored the folder.')).toHaveCount(0);
  await work.locator('.turn-work-toggle').click();
  await expect(work.locator('.tool')).toHaveCount(0);
});

test('reading position stays put through updates and jump-to-latest restores following', async ({ page, baseURL }) => {
  await openChat(page, baseURL!);
  // Opening follows the bottom even as media above finishes loading late.
  const opened = page.locator('.messages');
  await page.waitForTimeout(500);
  expect(await opened.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(5);
  await expect(page.getByRole('button', { name: /Jump to latest/ })).toHaveCount(0);
  await page.locator('textarea').fill('long context');
  await page.locator('textarea').press('Enter');
  await expect(page.getByText('Paragraph 70:', { exact: false }).last()).toBeVisible();
  const scroller = page.locator('.messages');
  await scroller.evaluate((element) => { element.scrollTop = element.scrollHeight / 2; });
  await expect(page.getByRole('button', { name: /Jump to latest/ })).toBeVisible();
  const before = await scroller.evaluate((element) => element.scrollTop);
  await page.getByRole('button', { name: 'Limits', exact: true }).click();
  await page.getByRole('button', { name: 'Close limits', exact: true }).click();
  await expect(page.getByRole('button', { name: /Jump to latest/ })).toBeVisible();
  await expect.poll(async () => Math.abs(await scroller.evaluate((element) => element.scrollTop) - before)).toBeLessThan(5);
  await page.locator('textarea').fill('stream update');
  await page.locator('textarea').press('Enter');
  await expect(page.getByText(/Stream complete/).last()).toBeAttached();
  expect(Math.abs(await scroller.evaluate((element) => element.scrollTop) - before)).toBeLessThan(5);
  await page.getByRole('button', { name: /Jump to latest/ }).click();
  await expect.poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(5);
});

test('Electron renderer supports the same tools, snapshots, viewer and media controls', async ({ baseURL }) => {
  test.setTimeout(60_000);
  const home = await mkdtemp(join(tmpdir(), 'accio-chat-electron-'));
  const electron = require.resolve('electron', { paths: [resolve('apps/desktop')] });
  const executablePath = require(electron) as string;
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined));
  const desktop = await _electron.launch({ executablePath, args: [resolve('tests/electron-shell.cjs'), `--user-data-dir=${home}`], env: { ...environment, ACCIO_CHAT_TEST_URL: baseURL!, ACCIO_CHAT_TEST_DOWNLOADS: home } });
  try {
    const page = await desktop.firstWindow();
    await openChat(page, baseURL!, false);
    await mediaAndTools(page, desktop);
  } finally {
    await desktop.close();
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('a choice shows screenshots full size and sends the pick with feedback', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/#token=${token}`);
  await page.getByRole('button', { name: /Choice fixture/ }).click();
  await expect(page.getByText('Which Accounts layout?')).toBeVisible();
  await expect(page.locator('.choice-option')).toHaveCount(3);
  for (const label of ['List rows', 'Cards', 'Grouped by provider']) {
    await expect.poll(() => page.getByAltText(label).evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(480);
  }

  // Full size: arrows browse, and the one button picks.
  await page.getByRole('button', { name: 'View A · List rows' }).click();
  const viewer = page.getByRole('dialog', { name: 'Which Accounts layout?' });
  await expect(viewer).toContainText('1 / 3');
  await page.keyboard.press('ArrowLeft');
  await expect(viewer).toContainText('3 / 3');
  await expect(viewer).toContainText('C · Grouped by provider');
  await viewer.getByRole('button', { name: 'Pick C' }).click();
  await expect(viewer).toHaveCount(0);

  // The pick waits in the composer, with the cursor ready for feedback.
  await expect(page.locator('.composer-chip')).toContainText('C · Grouped by provider');
  await expect(page.getByRole('textbox')).toBeFocused();
  await page.getByRole('button', { name: 'Pick B · Cards' }).click({ force: true });
  await expect(page.locator('.composer-chip')).toContainText('B · Cards');
  await page.getByRole('button', { name: 'Picked B · Cards' }).click();
  await expect(page.locator('.composer-chip')).toHaveCount(0);
  await page.getByRole('button', { name: 'Pick C · Grouped by provider' }).click({ force: true });
  // The viewer shows the pick too, and Escape leaves it as it was.
  await page.getByRole('button', { name: 'View C · Grouped by provider' }).click();
  await expect(viewer.getByRole('button', { name: 'Picked' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  await page.getByRole('button', { name: 'Limits', exact: true }).click();
  await page.getByRole('button', { name: 'Close limits', exact: true }).click();
  await expect(page.locator('.composer-chip')).toContainText('C · Grouped by provider');
  await page.getByRole('textbox').fill('but without the toggles');
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(page.getByText('Got it: I pick C ("Grouped by provider") for "Which Accounts layout?".')).toBeVisible();
  const sent = page.locator('.msg.user').last();
  await expect(sent.locator('.msg-pick')).toHaveText('✓ C · Grouped by provider');
  await expect(sent).toContainText('but without the toggles');
  await expect(page.locator('.choice')).toHaveClass(/answered/);
  await expect(page.locator('.choice-option.selected')).toHaveCount(1);
  await expect(page.locator('.composer-chip')).toHaveCount(0);
});
