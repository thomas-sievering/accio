import { expect, test, _electron, type Page, type ElectronApplication } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const token = 'isolated-chat-test-token';
async function openChat(page: Page, baseURL: string, navigate = true) {
  if (navigate) await page.goto(`${baseURL}/#token=${token}`);
  await page.getByRole('button', { name: /Inline chat fixture/ }).click();
  await expect(page.getByAltText('Saved picture')).toBeAttached();
}

async function mediaAndTools(page: Page, desktop?: ElectronApplication) {
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

test('reading position stays put through updates and jump-to-latest restores following', async ({ page, baseURL }) => {
  await openChat(page, baseURL!);
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
