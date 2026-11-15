import { expect, test, type Locator, type Page } from '@playwright/test';
import { CHAT_TOKEN, chatClient } from './chat.js';

// Motion from #213: popover rows stagger on a first open only, shelves open into place only when a
// status change creates them, main actions sink when pressed, and rows slide when a status change
// moves them while filtering stays instant.

/** Samples an element over several frames: its transform, opacity and running animations. */
async function frames(target: Locator, count = 8) {
  return target.evaluateAll(async (els, n) => {
    const seen: { transform: string; opacity: string; animations: number }[] = [];
    for (let i = 0; i < n; i++) {
      await new Promise(requestAnimationFrame);
      for (const el of els) {
        const style = getComputedStyle(el);
        seen.push({ transform: style.transform, opacity: style.opacity, animations: el.getAnimations().length });
      }
    }
    return seen;
  }, count);
}
const still = (sample: { transform: string; opacity: string; animations: number }) =>
  (sample.transform === 'none' || sample.transform === 'matrix(1, 0, 0, 1, 0, 0)') && sample.opacity === '1' && sample.animations === 0;

/** Starts idle threads titled by `texts` without a project, for this spec alone. */
async function startThreads(baseURL: string, texts: string[]) {
  const client = await chatClient(baseURL);
  try {
    for (const text of texts) {
      const started = await client.call('threads.start', { profileId: 'personal', text });
      await client.waitFor('threads.changed', (threads) => threads.some((t) => t.id === started.id && t.status === 'idle'));
    }
  } finally { client.close(); }
}

const row = (page: Page, title: string) => page.locator('.sidebar .row-slot').filter({ has: page.locator('.row-title', { hasText: title }) });

test('the New thread picker staggers its rows on opening only, never while typing', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/#token=${CHAT_TOKEN}`);
  await page.locator('.sidebar').getByRole('button', { name: 'New thread', exact: true }).click();
  const picker = page.locator('.new-thread-picker:popover-open');
  const options = picker.getByRole('option');
  // The first open rises row by row.
  expect((await frames(options, 2)).some((s) => s.animations > 0)).toBe(true);
  await expect(picker).not.toHaveAttribute('data-entering');
  const all = await options.count();
  const search = page.getByRole('combobox', { name: 'Search projects' });
  await search.pressSequentially('issues');
  await expect.poll(() => options.count()).toBeLessThan(all);
  for (let i = 0; i < 6; i++) await search.press('Backspace');
  await expect(options).toHaveCount(all);
  // Rows mounted by widening the search are there at once.
  expect((await frames(options)).every(still)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('.new-thread-picker:popover-open')).toHaveCount(0);
});

test('settling slides the rows below into place; searching and shelves returning stay still', async ({ page, baseURL }) => {
  const prefix = `Slide ${Date.now()}`;
  await startThreads(baseURL!, [`${prefix} C`, `${prefix} B`, `${prefix} A`]);
  await page.goto(`${baseURL}/#token=${CHAT_TOKEN}`);
  const search = page.getByRole('searchbox', { name: 'Search threads', exact: true });
  await search.fill(prefix);
  await expect(page.locator('.sidebar nav > .rows .row-title')).toHaveText([`${prefix} A`, `${prefix} B`, `${prefix} C`]);
  // Newest first; settle the top one, so B and C move up.
  await row(page, `${prefix} A`).hover();
  await row(page, `${prefix} A`).getByRole('button', { name: 'Settle', exact: true }).click();
  const slide = await frames(row(page, `${prefix} C`), 12);
  expect(slide.some((s) => /matrix\(1, 0, 0, 1, 0, [1-9]/.test(s.transform)), JSON.stringify(slide)).toBe(true);
  await expect(page.locator('.sidebar nav > .rows .row-title')).toHaveText([`${prefix} B`, `${prefix} C`]);

  // Narrowing and widening the search moves nothing and replays no shelf.
  await expect(page.locator('.shelf', { hasText: 'Settled' })).toBeVisible();
  await search.fill(`${prefix} C`);
  expect((await frames(page.locator('.sidebar .row-slot, .sidebar .shelf'))).every(still)).toBe(true);
  await search.fill('no thread is called this');
  await expect(page.locator('.shelf')).toHaveCount(0);
  await search.fill(prefix);
  await expect(page.locator('.shelf', { hasText: 'Settled' })).toBeVisible();
  expect((await frames(page.locator('.sidebar .row-slot, .sidebar .shelf'))).every(still)).toBe(true);
  await expect(page.locator('.shelf.arriving')).toHaveCount(0);
});

test('reduced motion: settled rows leave without sliding the rest', async ({ page, baseURL }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const prefix = `Still ${Date.now()}`;
  await startThreads(baseURL!, [`${prefix} B`, `${prefix} A`]);
  await page.goto(`${baseURL}/#token=${CHAT_TOKEN}`);
  await page.getByRole('searchbox', { name: 'Search threads', exact: true }).fill(prefix);
  await expect(page.locator('.sidebar nav > .rows .row-title')).toHaveText([`${prefix} A`, `${prefix} B`]);
  await row(page, `${prefix} A`).hover();
  await row(page, `${prefix} A`).getByRole('button', { name: 'Settle', exact: true }).click();
  const after = await frames(row(page, `${prefix} B`), 12);
  expect(after.every((s) => s.transform === 'none'), JSON.stringify(after)).toBe(true);
  await expect(page.locator('.sidebar nav > .rows .row-title')).toHaveText([`${prefix} B`]);
});

test('Send, sheet primary buttons and shelf heads sink while pressed', async ({ page, baseURL }) => {
  const title = `Press ${Date.now()}`;
  await startThreads(baseURL!, [title]);
  await page.goto(`${baseURL}/#token=${CHAT_TOKEN}`);
  await page.getByRole('searchbox', { name: 'Search threads', exact: true }).fill(title);
  await row(page, title).locator('.row-main').click();
  const composer = page.locator('.composer textarea');
  await composer.fill('Not sent: pressing only');
  const send = page.getByRole('button', { name: 'Send', exact: true });
  // The settle test above left a Settled shelf; clear the search so its head shows.
  await page.getByRole('searchbox', { name: 'Search threads', exact: true }).fill('');
  const shelfHead = page.locator('.shelf-head').first();
  await expect(shelfHead).toBeVisible();
  for (const button of [send, shelfHead]) {
    const box = (await button.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect.poll(() => button.evaluate((el) => getComputedStyle(el).scale)).toBe('0.94');
    // Release off the button, so the press never sends or toggles.
    await page.mouse.move(box.x + box.width / 2, box.y - 200);
    await page.mouse.up();
    await expect.poll(() => button.evaluate((el) => getComputedStyle(el).scale)).not.toBe('0.94');
  }
  await composer.fill('');
  // A sheet's primary button shares the rule.
  expect(await page.evaluate(() => [...document.styleSheets].some((sheet) => {
    try { return [...sheet.cssRules].some((r) => r.cssText.includes('.ghost.primary:active:not(:disabled)') && r.cssText.includes('scale: 0.94')); } catch { return false; }
  }))).toBe(true);
});
