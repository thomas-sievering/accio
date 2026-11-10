import { expect, test, _electron, type Page, type ElectronApplication } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const token = 'isolated-chat-test-token';

test('Claude cache usage shows provider accounting once and survives reopening', async ({ page, baseURL }, testInfo) => {
  await page.goto(`${baseURL}/#token=${token}`);
  await page.locator('.sidebar').getByRole('button', { name: 'New thread', exact: true }).click();
  await page.getByRole('option', { name: 'No project', exact: true }).click();
  if (await page.getByRole('combobox', { name: 'Search profiles' }).isVisible()) await page.getByRole('option', { name: 'Personal', exact: true }).click();
  await expect(page.locator('.context-meter')).toHaveCount(0);
  await page.locator('.composer textarea').fill('Cache usage fixture');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Cache usage recorded.', { exact: true })).toBeVisible();
  await expect(page.locator('.composer .stop')).toHaveCount(0);
  // GLOSSARY: Context window. The pill shows it; cache and limits wait in its popover.
  const meter = page.locator('.context-meter');
  await expect(meter.locator('> summary')).toHaveText('1k / 200k');
  await expect(meter.locator('> summary')).toHaveAttribute('aria-label', 'Context: 1,000 tokens of 200,000 (1%)');
  await expect(page.locator('.composer-bar .limits-chip')).toBeHidden();
  const stat = page.locator('.cache-usage');
  const open = async () => {
    await meter.locator('> summary').click();
    await expect(meter.getByRole('meter', { name: 'Context window used' })).toHaveAttribute('aria-valuenow', '1');
    await expect(meter.locator('.context-compact-tick')).toBeVisible();
    await expect(meter).toContainText('Compacts automatically at about 167,000 tokens.');
    await expect(meter.locator('.limits-chip')).toBeVisible();
    await expect(stat.locator('summary')).toHaveText('Prompt cache80% read');
    await stat.locator('summary').click();
    await expect(stat.locator('dd')).toHaveText(['800', '100', '100', '100']);
  };
  await open();
  await expect(stat).toContainText('excludes subagents and title generation');
  await page.screenshot({ path: testInfo.outputPath('cache-usage.png') });
  await page.reload();
  await open();
});

for (const submit of ['Enter', 'Send'] as const) {
  test(`first ${submit} shows the message before thread startup completes and recovers a failed start`, async ({ page, baseURL }, testInfo) => {
    let release: (() => void) | undefined;
    let starts = 0;
    await page.routeWebSocket('**/ws?*', socket => {
      const server = socket.connectToServer();
      socket.onMessage(message => {
        const request = JSON.parse(String(message));
        if (request.method !== 'threads.start') { server.send(message); return; }
        starts++;
        release = starts === 1
          ? () => socket.send(JSON.stringify({ type: 'response', id: request.id, ok: false, error: 'Startup unavailable. Try again.' }))
          : () => server.send(message);
      });
    });
    await page.goto(`${baseURL}/#token=${token}`);
    await page.locator('.sidebar').getByRole('button', { name: 'New thread', exact: true }).click();
    await page.getByRole('option', { name: 'No project', exact: true }).click();
    if (await page.getByRole('combobox', { name: 'Search profiles' }).isVisible()) await page.getByRole('option', { name: 'Personal', exact: true }).click();
    const input = page.locator('.composer textarea');
    const text = `First ${submit} startup feedback`;
    await input.fill(text);
    const send = async () => {
      if (submit === 'Enter') await input.press('Enter');
      else await page.getByRole('button', { name: 'Send', exact: true }).click();
    };
    await send();
    const pending = page.locator('.draft-starting');
    await expect(pending.locator('.msg.user')).toHaveText(text);
    await expect(pending.getByRole('status')).toHaveText('Starting thread…');
    // The composer settles at the foot, emptied and out of reach until the start completes.
    await expect(page.locator('.hero.starting')).toHaveAttribute('inert', '');
    // Enter again while startup is held cannot create a duplicate thread.
    await page.keyboard.press('Enter');
    expect(starts).toBe(1);
    await page.screenshot({ path: testInfo.outputPath('first-send-starting.png') });
    release!();
    await expect(page.locator('.composer-error')).toHaveText('Startup unavailable. Try again.');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue(text);
    await send();
    await expect(pending.getByRole('status')).toBeVisible();
    expect(starts).toBe(2);
    release!();
    await expect(pending).toHaveCount(0);
    await expect(page.locator('.messages .msg.user')).toHaveText(text);
    await expect(page.locator('.composer textarea')).toHaveValue('');
    await page.reload();
    await expect(page.locator('.messages .msg.user')).toHaveText(text);
  });
}

test('a thread that finishes starting after you moved to another stays in the background', async ({ page, baseURL }) => {
  let release: (() => void) | undefined;
  await page.routeWebSocket('**/ws?*', socket => {
    const server = socket.connectToServer();
    socket.onMessage(message => {
      if (JSON.parse(String(message)).method === 'threads.start') release = () => server.send(message);
      else server.send(message);
    });
  });
  await page.goto(`${baseURL}/#token=${token}`);
  await page.locator('.sidebar').getByRole('button', { name: 'New thread', exact: true }).click();
  await page.getByRole('option', { name: 'No project', exact: true }).click();
  if (await page.getByRole('combobox', { name: 'Search profiles' }).isVisible()) await page.getByRole('option', { name: 'Personal', exact: true }).click();
  const text = 'Started in the background';
  await page.locator('.composer textarea').fill(text);
  await page.locator('.composer textarea').press('Enter');
  await expect(page.locator('.draft-starting')).toBeVisible();
  await expect.poll(() => !!release).toBe(true);
  await page.locator('.sidebar').getByRole('button', { name: /Inline chat fixture/ }).click();
  await expect(page.locator('.draft-starting')).toHaveCount(0);
  release!();
  await expect(page.locator('.sidebar .row-main').filter({ hasText: text })).toBeVisible();
  await expect(page.locator('.sidebar .row-main[aria-current="page"]')).toContainText('Inline chat fixture');
  await expect(page.locator('.messages .msg.user').filter({ hasText: text })).toHaveCount(0);
});

test('Enter steers, Ctrl changes Send and queues; an unsaved queued edit closes when the turn ends', async ({ page, baseURL }, testInfo) => {
  await page.goto(`${baseURL}/#token=${token}`);
  await page.locator('.sidebar').getByRole('button', { name: /Inline chat fixture/ }).click();
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
  // The edit tray belongs to its turn: when the turn ends it closes, discarding the unsaved edit and releasing the original message.
  await expect(tray).toHaveCount(0);
  await expect(page.getByText('Finished: Queued second', { exact: true })).toBeVisible();
  await expect(page.getByText('Finished: Queued edited', { exact: true })).toHaveCount(0);
  await page.reload();
  await page.locator('.sidebar').getByRole('button', { name: /Inline chat fixture/ }).click();
  await expect(page.getByText('Steered: Use the existing helper', { exact: true })).toBeVisible();
});
async function openChat(page: Page, baseURL: string, navigate = true) {
  if (navigate) await page.goto(`${baseURL}/#token=${token}`);
  await page.locator('.sidebar').getByRole('button', { name: /Inline chat fixture/ }).click();
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
  await expect(failed.locator('.tool-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(failed.locator('.tool-details')).toHaveCount(0);
  await expect(failed.locator('.tool-summary')).toHaveText('fixture-failure');
  await failed.locator('.tool-toggle').click();
  await expect(failed.locator('[aria-label="Tool input"]')).toContainText('powershell.exe');
  await expect(failed).toContainText('Expected fixture failure');
  await success.locator('.tool-toggle').click();
  // Long output is capped at 20 lines until the person asks for all of it.
  await expect(success).not.toContainText('FULL_OUTPUT_TAIL');
  await success.getByRole('button', { name: /^Show all \d+ lines$/ }).click();
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

test('a running turn shows what it says as it goes and its latest calls behind one status line, then folds under Worked for', async ({ page, baseURL }) => {
  await openChat(page, baseURL!);
  // Inside a fold, calls sit bare on the rail and failures stay collapsed.
  const fixture = page.locator('.turn-work').first();
  await fixture.locator('.turn-work-toggle').click();
  await expect(fixture.locator('.tool-group-toggle')).toHaveCount(0);
  await expect(fixture.locator('.tool')).toHaveCount(2);
  await expect(fixture.locator('.tool.error .tool-toggle')).toHaveAttribute('aria-expanded', 'false');

  await page.locator('textarea').fill('explore tools');
  await page.locator('textarea').press('Enter');
  const live = page.locator('.turn-work.live');
  const status = live.getByRole('status');
  // What it says before a call shows right away, above the live line.
  await expect(status).toHaveText('Running ls');
  await expect(live).not.toContainText('ls -la');
  await expect(page.locator('.msg.assistant', { hasText: 'I’ll look around the folder first.' })).toBeVisible();
  await expect(live.locator('.turn-work-elapsed')).toHaveText(/^(<1s|\d+s)$/);
  await expect(live.locator('.tool')).toHaveCount(0);
  await expect(status).toHaveText('Reading files');
  // Opening it while running shows the calls since the last message, and it stays open once the turn completes.
  await live.locator('.turn-work-toggle').click();
  await expect(live.locator('.tool-summary')).toHaveText(['ls -la', 'README.md']);
  // A later message stays in order; the live line below it holds only the calls after it.
  await expect(status).toHaveText('Searching');
  await expect(page.locator('.msg.assistant', { hasText: 'Now checking for open TODOs.' })).toBeVisible();
  await expect(live.locator('.tool-summary')).toHaveText(['TODO']);
  const earlierCalls = page.locator('.tool-group').filter({ has: page.locator('.tool-group-toggle') });
  await expect(earlierCalls.locator('.tool-group-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(earlierCalls.locator('.tool')).toHaveCount(0);
  await earlierCalls.locator('.tool-group-toggle').click();
  await expect(earlierCalls.locator('.tool-summary')).toHaveText(['ls -la', 'README.md']);
  await page.screenshot({ path: test.info().outputPath('running-turn.png') });

  await expect(page.getByText('Explored the folder.')).toBeVisible();
  await expect(live).toHaveCount(0);
  const work = page.locator('.turn-work').last();
  await expect(work.locator('.turn-work-toggle')).toHaveText(/^Worked for \d+s$/);
  await expect(work.locator('.turn-work-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(work.locator('.tool.done')).toHaveCount(3);
  await expect(work.locator('.tool-summary')).toHaveText(['ls -la', 'README.md', 'TODO']);
  await expect(work.getByText('Explored the folder.')).toHaveCount(0);
  await expect(work.locator('.msg.assistant')).toHaveText(['I’ll look around the folder first.', 'Now checking for open TODOs.']);
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

test('running sub-agents show their latest step, then fold into ordinary Agent rows', async ({ page, baseURL }, testInfo) => {
  await page.goto(`${baseURL}/#token=${token}`);
  await page.getByRole('button', { name: /Inline chat fixture/ }).click();
  const input = page.locator('.composer textarea');
  await input.fill('Sub-agent fixture'); await input.press('Enter');
  // The live line names what the newest sub-agent is doing now.
  await expect(page.locator('.turn-work-activity')).toHaveText(/^Running agent · Running git$/);
  await page.locator('.turn-work-activity').click();
  const rows = page.locator('.tool.running');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'Find where deliveries retry' }).locator('.tool-step')).toHaveText('Reading files');
  await expect(rows.filter({ hasText: 'Review the transcript diff' }).locator('.tool-step')).toHaveText('Running git');
  await page.screenshot({ path: testInfo.outputPath('subagents-running.png') });
  await expect(rows.filter({ hasText: 'Find where deliveries retry' }).locator('.tool-step')).toHaveText('Running pnpm', { timeout: 10_000 });
  await expect(page.getByText('Both sub-agents reported back.')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.tool-step')).toHaveCount(0);
});

test('a choice shows screenshots full size and sends the pick with feedback', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/#token=${token}`);
  await page.locator('.sidebar').getByRole('button', { name: /Choice fixture/ }).click();
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
  await expect(page.locator('.composer textarea')).toBeFocused();
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
  await page.locator('.composer textarea').fill('but without the toggles');
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  await expect(page.getByText('Got it: I pick C ("Grouped by provider") for "Which Accounts layout?".')).toBeVisible();
  const sent = page.locator('.msg.user').last();
  await expect(sent.locator('.msg-pick')).toHaveText('✓ C · Grouped by provider');
  await expect(sent).toContainText('but without the toggles');
  await expect(page.locator('.choice')).toHaveClass(/answered/);
  await expect(page.locator('.choice-option.selected')).toHaveCount(1);
  await expect(page.locator('.composer-chip')).toHaveCount(0);
});


test('choice screenshots show grant errors and offer recovery', async ({ page, baseURL }) => {
  let failGrants = true;
  const disconnect: (() => void)[] = [];
  await page.routeWebSocket('**/ws?*', socket => {
    const server = socket.connectToServer();
    disconnect.push(() => { socket.close(); server.close(); });
    socket.onMessage(message => {
      const request = JSON.parse(String(message));
      if (request.method === 'threads.assetUrl' && failGrants) socket.send(JSON.stringify({ type: 'response', id: request.id, ok: false, error: 'Screenshot grant unavailable' }));
      else server.send(message);
    });
  });
  await page.goto(`${baseURL}/#token=${token}`);
  await page.locator('.sidebar').getByRole('button', { name: /Choice fixture/ }).click();
  await expect(page.locator('.choice-missing')).toHaveCount(3);
  await expect(page.locator('.choice-missing').first()).toContainText('Screenshot grant unavailable');
  failGrants = false;
  await page.getByRole('button', { name: 'Retry screenshot', exact: true }).first().click();
  await expect.poll(() => page.getByAltText('List rows').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(480);
  disconnect.splice(0).forEach(close => close());
  await expect(page.locator('.choice-missing')).toHaveCount(0);
  for (const label of ['List rows', 'Cards', 'Grouped by provider']) await expect.poll(() => page.getByAltText(label).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(480);
});


test('reconnecting preserves a renewed video source and playback position', async ({ page, baseURL }) => {
  let connections = 0;
  let failObserve = false;
  const disconnect: (() => void)[] = [];
  await page.routeWebSocket('**/ws?*', socket => {
    connections++;
    const server = socket.connectToServer();
    disconnect.push(() => { socket.close(); server.close(); });
    socket.onMessage(message => {
      const request = JSON.parse(String(message));
      if (request.method === 'threads.observe' && failObserve) socket.send(JSON.stringify({ type: 'response', id: request.id, ok: false, error: 'Snapshot temporarily unavailable' }));
      else server.send(message);
    });
  });
  await openChat(page, baseURL!);
  const video = page.locator('video[aria-label="Demo clip"]');
  await video.scrollIntoViewIfNeeded();
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState)).toBeGreaterThanOrEqual(3);
  const source = await video.getAttribute('src');
  await page.route('**/thread-assets/*', route => route.request().url() === source ? route.fulfill({ status: 404 }) : route.continue());
  await video.evaluate((el: HTMLVideoElement) => el.load());
  await expect(video).not.toHaveAttribute('src', source!);
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState)).toBeGreaterThanOrEqual(3);
  await video.evaluate((el: HTMLVideoElement) => { el.currentTime = 1.2; el.pause(); });
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => Math.abs(el.currentTime - 1.2))).toBeLessThan(0.15);
  const renewed = await video.getAttribute('src');
  const before = connections;
  disconnect.splice(0).forEach(close => close());
  await expect.poll(() => connections).toBeGreaterThan(before);
  // Reconnection is established by an enabled model control; no reload or navigation.
  await expect(page.getByRole('button', { name: /^Select model:/ })).toBeEnabled();
  await expect(video).toHaveAttribute('src', renewed!);
  expect(await video.evaluate((el: HTMLVideoElement) => Math.abs(el.currentTime - 1.2))).toBeLessThan(0.15);
  expect(await video.evaluate((el: HTMLVideoElement) => el.paused)).toBe(true);
  failObserve = true;
  disconnect.splice(0).forEach(close => close());
  const refreshError = page.locator('.notice-bar', { hasText: 'Could not refresh transcript' });
  await expect(refreshError).toContainText('Snapshot temporarily unavailable');
  failObserve = false;
  await refreshError.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(refreshError).toHaveCount(0);
  await expect(video).toHaveAttribute('src', renewed!);
  expect(await video.evaluate((el: HTMLVideoElement) => Math.abs(el.currentTime - 1.2))).toBeLessThan(0.15);
});
