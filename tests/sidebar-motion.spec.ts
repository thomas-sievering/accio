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

/** The sidebar row titled exactly `title`. */
const row = (page: Page, title: string) => page.locator('.sidebar .row-slot').filter({ has: page.locator('.row-title').getByText(title, { exact: true }) });
/**
 * Every sidebar row or shelf that moves, fades or animates over a few frames, with what it did.
 * One at opacity 0 is leaving at once (a zero-length exit), which reads as instant.
 */
const stillSidebar = (page: Page) => page.locator('.sidebar .row-slot, .sidebar .shelf').evaluateAll(async (els) => {
  const moving: string[] = [];
  for (let i = 0; i < 8; i++) {
    await new Promise(requestAnimationFrame);
    for (const el of els) {
      const style = getComputedStyle(el);
      if (!el.isConnected || style.opacity === '0') continue;
      if (!['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(style.transform) || style.opacity !== '1' || el.getAnimations().length)
        moving.push(`${el.className} ${el.textContent?.slice(0, 30)} ${style.transform} ${style.opacity} ${el.getAnimations().map((a) => (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty).join()}`);
    }
  }
  return [...new Set(moving)];
});
/** Waits until the sidebar's rows and shelves have finished moving. */
const settle = (page: Page) => expect.poll(async () => (await frames(page.locator('.sidebar .row-slot, .sidebar .shelf'), 2)).every(still)).toBe(true);

test('the New thread picker staggers its rows on opening only, never while typing', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/#token=${CHAT_TOKEN}`);
  await page.locator('.sidebar').getByRole('button', { name: 'New thread', exact: true }).click();
  const picker = page.locator('.new-thread-picker:popover-open');
  const options = picker.getByRole('option');
  // The first open rises row by row.
  expect((await frames(options, 2)).some((s) => s.animations > 0)).toBe(true);
  // The opening mark lasts a couple of frames, not the length of the rise.
  await expect(picker).not.toHaveAttribute('data-entering', { timeout: 200 });
  // Type straight away, while the opening rows are still rising.
  const all = await options.count();
  const search = page.getByRole('combobox', { name: 'Search projects' });
  await search.pressSequentially('issues');
  await expect.poll(() => options.count()).toBeLessThan(all);
  // Rows the search kept are still finishing the opening rise; tag them so only new rows are checked.
  await options.evaluateAll((els) => els.forEach((el) => el.setAttribute('data-kept', '')));
  for (let i = 0; i < 6; i++) await search.press('Backspace');
  await expect(options).toHaveCount(all);
  // Rows mounted by widening the search start in place, fully shown.
  const widened = await picker.locator('[role="option"]:not([data-kept])').evaluateAll(async (els) => {
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      await new Promise(requestAnimationFrame);
      for (const el of els) { const style = getComputedStyle(el); seen.push(`${style.opacity} ${style.translate}`); }
    }
    return [...new Set(seen)];
  });
  expect(widened).toEqual(['1 none']);
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
  await settle(page);
  await search.fill(`${prefix} C`);
  expect(await stillSidebar(page)).toEqual([]);
  await search.fill('no thread is called this');
  await expect(page.locator('.shelf')).toHaveCount(0);
  await search.fill(prefix);
  await expect(page.locator('.shelf', { hasText: 'Settled' })).toBeVisible();
  expect(await stillSidebar(page)).toEqual([]);
  await expect(page.locator('.shelf.arriving')).toHaveCount(0);

  // Deleting a row from an expanded shelf fades it out.
  const settled = page.locator('.shelf', { hasText: 'Settled' });
  await settled.locator('.shelf-head').click();
  await row(page, `${prefix} A`).locator('.row-main').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete thread' }).click();
  // Watch the row every frame from the confirming click until it leaves the page. Its shelf held
  // only this row, so the shelf fades with it: measure the opacity on screen, through its ancestors.
  // Kept on window: returning the promise would make Playwright wait for it before the click.
  await row(page, `${prefix} A`).evaluate((el) => {
    (window as unknown as { leaving: Promise<number[]> }).leaving = new Promise((done) => {
      const seen: number[] = [];
      const look = () => {
        if (!el.isConnected || seen.length > 300) return done(seen);
        let shown = 1;
        for (let at: Element | null = el; at; at = at.parentElement) shown *= Number(getComputedStyle(at).opacity);
        seen.push(shown);
        requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    });
  });
  await page.getByRole('menuitem', { name: 'Delete thread' }).click();
  const leaving = await page.evaluate(() => (window as unknown as { leaving: Promise<number[]> }).leaving);
  expect(leaving.some((o) => o > 0 && o < 1), JSON.stringify([...new Set(leaving)])).toBe(true);
  await expect(row(page, `${prefix} A`)).toHaveCount(0);
});

test('a thread arriving in the inbox comes into focus, then keeps no filter', async ({ page, baseURL }) => {
  const prefix = `Arrive ${Date.now()}`;
  await startThreads(baseURL!, [`${prefix} B`, `${prefix} A`]);
  await page.goto(`${baseURL}/#token=${CHAT_TOKEN}`);
  await page.getByRole('searchbox', { name: 'Search threads', exact: true }).fill(prefix);
  await expect(page.locator('.sidebar nav > .rows .row-title')).toHaveText([`${prefix} A`, `${prefix} B`]);
  await row(page, `${prefix} A`).hover();
  await row(page, `${prefix} A`).getByRole('button', { name: 'Settle', exact: true }).click();
  await expect(page.locator('.sidebar nav > .rows .row-title')).toHaveText([`${prefix} B`]);
  await settle(page);

  // Watch for the row to land in the inbox, then sample it every frame until it is still.
  await page.evaluate((title) => {
    (window as unknown as { arriving: Promise<string[]> }).arriving = new Promise((done) => {
      const seen: string[] = [];
      const look = () => {
        const el = [...document.querySelectorAll('.sidebar nav > .rows .row-slot')].find((s) => s.querySelector('.row-title')?.textContent === title);
        if (el) {
          const style = getComputedStyle(el);
          seen.push(`${style.opacity} ${style.filter}`);
          if (seen.length > 300 || (style.opacity === '1' && style.filter === 'none')) return done(seen);
        }
        requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    });
  }, `${prefix} A`);
  const client = await chatClient(baseURL!);
  try {
    const id = (await client.call('threads.list', {})).find((t) => t.title === `${prefix} A`)!.id;
    await client.call('threads.reopen', { threadId: id });
  } finally { client.close(); }
  const arriving = await page.evaluate(() => (window as unknown as { arriving: Promise<string[]> }).arriving);
  expect(arriving.some((s) => /^0\.\d+ blur\([0-9.]+px\)$/.test(s)), JSON.stringify(arriving)).toBe(true);
  expect(arriving.at(-1)).toBe('1 none');
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
  await startThreads(baseURL!, [`${title} shelved`, title]);
  await page.goto(`${baseURL}/#token=${CHAT_TOKEN}`);
  const search = page.getByRole('searchbox', { name: 'Search threads', exact: true });
  await search.fill(title);
  // Settle one, so a shelf head is there to press.
  await row(page, `${title} shelved`).hover();
  await row(page, `${title} shelved`).getByRole('button', { name: 'Settle', exact: true }).click();
  await row(page, title).locator('.row-main').click();
  const composer = page.locator('.composer textarea');
  await composer.fill('Not sent: pressing only');
  const send = page.getByRole('button', { name: 'Send', exact: true });
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
