import { expect, test, type Page } from '@playwright/test';
import jsQR from 'jsqr';
import { TestClient } from '../apps/worker/src/testing/testApp.js';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

async function pairedClients(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('.sidebar nav').getByRole('button', { name: 'Machines', exact: true }).click();
  return page.locator('section').filter({ has: page.getByRole('heading', { name: 'Paired clients', exact: true }) });
}

async function openPairedHub(page: Page, desktop: TestClient) {
  const { code, url } = await desktop.call('clients.createPairingCode', {});
  const hub = new URL('/', url ?? (await desktop.call('hubs.list', {}))[0]!.url).origin;
  await page.goto(hub);
  await page.getByRole('textbox', { name: 'Pairing code' }).fill(code);
  await page.getByRole('button', { name: 'Pair browser', exact: true }).click();
  await expect(page).toHaveURL(`${hub}/`);
}

test('pairs browsers by typing a code or opening the QR URL and unpairs them from either client', async ({ browser, page, baseURL }) => {
  await page.goto(`${baseURL}/#token=relay-test-token`);
  const clients = await pairedClients(page);
  await expect(clients.getByText('No paired clients yet')).toBeVisible();
  const makeCode = async (label: string, previous?: string) => {
    await clients.getByRole('button', { name: label, exact: true }).click();
    await expect(clients.getByRole('img', { name: 'Browser pairing QR code' })).toBeVisible();
    const code = clients.getByRole('status').locator('code');
    if (previous) await expect(code).not.toHaveText(previous);
    return (await code.textContent())!;
  };
  const firstCode = await makeCode('Pair a browser');
  const hub = (await clients.locator('p > code').first().textContent())!;
  const phone = await browser.newContext({ userAgent: 'iPhone Version/18.0 Safari/604.1', viewport: { width: 390, height: 844 } });
  const tablet = await browser.newContext({ userAgent: 'iPad Version/18.0 Safari/604.1' });
  try {
    const typed = await phone.newPage();
    const scanned = await tablet.newPage();
    const pairing = 'Pair this browser';
    await typed.goto(hub);
    await expect(typed.getByRole('heading', { name: pairing })).toBeVisible();
    await expect(typed.getByRole('heading', { name: 'Paired clients' })).toHaveCount(0);
    await typed.getByRole('textbox', { name: 'Pairing code' }).fill(firstCode);
    await typed.getByRole('button', { name: 'Pair browser', exact: true }).click();
    await expect(typed.locator('.sidebar')).toBeVisible();
    expect(await typed.evaluate(() => document.cookie)).not.toContain('accio-client');
    expect((await phone.cookies(hub)).find(({ name }) => name === '__Host-accio-client')).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict' });
    await typed.route('https://outside.example/', (route) => route.fulfill({ contentType: 'text/html', body: `<a href="${hub}">Open Accio</a>` }));
    await typed.goto('https://outside.example/');
    await typed.getByRole('link', { name: 'Open Accio' }).click();
    await expect(typed.locator('.sidebar')).toBeVisible();
    await expect(clients.getByRole('button', { name: 'Unpair iPhone Safari' })).toBeVisible();
    await expect(page.locator('.machine-row').filter({ hasText: 'iPhone Safari' })).toHaveCount(0);

    const secondCode = await makeCode('Generate new browser code', firstCode);
    const qr = await clients.getByRole('img', { name: 'Browser pairing QR code' }).evaluate(async (svg) => {
      const image = new Image();
      image.src = 'data:image/svg+xml,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return { width: canvas.width, height: canvas.height, pixels: [...context.getImageData(0, 0, canvas.width, canvas.height).data] };
    });
    const destination = jsQR(new Uint8ClampedArray(qr.pixels), qr.width, qr.height)?.data;
    expect(destination).toBe(`${hub}/#${secondCode}`);
    await scanned.goto(destination!);
    await expect(scanned.locator('.sidebar')).toBeVisible();
    await expect(scanned).toHaveURL(`${hub}/`);
    const scannedClients = await pairedClients(scanned);
    await scannedClients.getByRole('button', { name: 'Unpair iPhone Safari' }).click();
    await scannedClients.getByRole('group', { name: 'Unpair iPhone Safari?' }).getByRole('button', { name: 'Unpair iPhone Safari' }).click();
    await expect(scannedClients.getByRole('button', { name: 'Unpair iPhone Safari' })).toHaveCount(0);
    await expect(clients.getByRole('button', { name: 'Unpair iPhone Safari' })).toHaveCount(0);
    await typed.reload();
    await expect(typed.getByRole('heading', { name: pairing })).toBeVisible();

    await clients.getByRole('button', { name: 'Unpair iPad Safari' }).click();
    const confirm = clients.getByRole('group', { name: 'Unpair iPad Safari?' });
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Unpair iPad Safari' }).click();
    await expect(clients.getByText('No paired clients yet')).toBeVisible();
    await scanned.reload();
    await expect(scanned.getByRole('heading', { name: pairing })).toBeVisible();
  } finally {
    await Promise.all([phone.close(), tablet.close()]);
  }
});

test('a paired phone reads threads across profiles and machines, streams a turn, and keeps the Offline shelf after reload', async ({ browser, baseURL }, info) => {
  test.setTimeout(60_000);
  const desktop = await TestClient.open(`${baseURL!.replace('http:', 'ws:')}/ws?token=relay-test-token`);
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: 'iPhone Version/18.0 Safari/604.1' });
  const checkoutId = (await desktop.call('projects.get', {})).checkouts[0]!.id;
  try {
    const { code, url } = await desktop.call('clients.createPairingCode', {});
    const hub = new URL('/', url ?? (await desktop.call('hubs.list', {}))[0]!.url).origin;
    const tab = await phone.newPage();
    const streamedThreads = new Set<string>();
    tab.on('websocket', (ws) => {
      if (!ws.url().endsWith('/client/relay')) return;
      ws.on('framereceived', ({ payload }) => {
        const frame = JSON.parse(String(payload));
        if (frame.kind === 'event' && frame.event === 'thread.delta') streamedThreads.add(frame.data.threadId);
      });
    });
    await tab.goto(hub);
    await expect(tab.getByRole('heading', { name: 'Pair this browser' })).toBeVisible();
    await tab.getByRole('textbox', { name: 'Pairing code' }).fill(code);
    await tab.getByRole('button', { name: 'Pair browser', exact: true }).click();
    const rows = tab.locator('.sidebar .row-main');
    const mac = rows.filter({ hasText: 'Hello from the MacBook' });
    await expect(mac.locator('.row-machine')).toHaveText('MacBook');
    await expect(rows.filter({ hasText: 'A thread on the PC' }).locator('.row-machine')).toHaveText('PC');
    const profile = await desktop.signedIn('Browser fixture');
    const machineId = (await desktop.call('machines.list', {})).find(({ name }) => name === 'MacBook')!.id;
    const thread = await desktop.call('threads.start', { profileId: profile.id, machineId, text: 'A long browser fixture turn' });
    await rows.filter({ hasText: 'A long browser fixture turn' }).click();
    await expect(tab.locator('.thread-machine')).toContainText('MacBook');
    await expect(tab.locator('.msg.user').last()).toContainText('A long browser fixture turn');
    await expect(tab.locator('.msg.assistant').last()).toContainText('MacBook here. You said: A long browser fixture turn', { timeout: 15_000 });
    expect(streamedThreads.has(thread.id)).toBe(true);
    await tab.getByRole('button', { name: 'Inbox', exact: true }).click();
    await expect(tab.getByRole('heading', { name: 'Inbox' })).toBeVisible();
    await tab.screenshot({ path: info.outputPath('phone-inbox.png'), animations: 'disabled' });

    await desktop.call('threads.start', { checkoutId, text: 'Put the MacBook to sleep' });
    const shelf = tab.getByRole('button', { name: /^Offline/ });
    await expect(shelf).toBeVisible({ timeout: 15_000 });
    await tab.reload();
    await expect(shelf).toBeVisible();
    if (await shelf.getAttribute('aria-expanded') === 'false') await shelf.click();
    await expect(mac.locator('.row-machine')).toHaveAttribute('aria-label', 'MacBook (offline)');
    await mac.click();
    await expect(tab.locator('.offline-thread')).toContainText('MacBook is offline');
    await expect(tab.locator('.offline-thread').getByRole('button')).toHaveText(['Retry']);
    await tab.screenshot({ path: info.outputPath('phone-offline.png') });
  } finally {
    await desktop.call('threads.start', { checkoutId, text: 'Wake the MacBook' });
    desktop.close();
    await phone.close();
  }
});

test('a paired browser drives a MacBook thread and keeps its draft across navigation and reload', async ({ page, baseURL }) => {
  const desktop = await TestClient.open(`${baseURL!.replace('http:', 'ws:')}/ws?token=relay-test-token`);
  let threadId: string | undefined;
  try {
    const profile = await desktop.signedIn('Browser driving fixture');
    const machineId = (await desktop.call('machines.list', {})).find(({ name }) => name === 'MacBook')!.id;
    const thread = await desktop.call('threads.start', { profileId: profile.id, machineId, text: 'Browser driving fixture' });
    threadId = thread.id;
    await openPairedHub(page, desktop);
    const rows = page.locator('.sidebar .row-main');
    const row = rows.filter({ hasText: 'Browser driving fixture' }).first();
    const other = rows.filter({ hasText: 'A thread on the PC' });
    await row.click();
    await expect(page.locator('.thread-machine')).toContainText('MacBook');
    const model = page.getByRole('button', { name: /^Select model:/ });
    const effort = page.getByRole('button', { name: /^Effort:/ });
    await expect(effort).toBeEnabled();
    await model.click();
    await page.getByRole('dialog', { name: 'Choose a model' }).locator('[data-model-choice]', { hasText: 'Sonnet' }).click();
    await expect(model).toHaveAccessibleName('Select model: Claude Sonnet');
    await effort.click();
    await page.getByRole('menu', { name: 'Effort', exact: true }).getByRole('menuitemradio', { name: 'High', exact: true }).click();
    await expect.poll(async () => (await desktop.call('threads.list', {})).find(({ id }) => id === thread.id)?.model).toMatchObject({ effort: 'high' });

    const input = page.locator('.composer textarea');
    await input.fill('Browser steering fixture');
    await other.click();
    await expect(input).toHaveValue('');
    await row.click();
    await expect(input).toHaveValue('Browser steering fixture');
    await page.reload();
    await expect(input).toHaveValue('Browser steering fixture');
    await expect(effort).toHaveAccessibleName('Effort: High');
    await expect(other).toBeVisible();
    const send = page.getByRole('button', { name: 'Send', exact: true });
    await send.click();
    await expect(page.locator('.sidebar .row-main[aria-current="page"]').first()).not.toContainText('Browser driving fixture');
    const working = page.getByRole('button', { name: /^Working \d/ });
    await expect(working).toBeVisible();
    if (await working.getAttribute('aria-expanded') === 'false') await working.click();
    await row.click();
    await expect(input).toHaveValue('');
    await expect(page.getByText('Waiting for browser steering.', { exact: true })).toBeVisible();

    await input.fill('Use the existing helper');
    await send.click();
    await expect(page.getByText('Steered: Use the existing helper', { exact: true })).toBeVisible();
    await input.fill('Queued from the browser');
    await page.getByRole('button', { name: /^Queue Ctrl/ }).click();
    const tray = page.getByRole('region', { name: 'Queued messages' });
    await expect(tray).toContainText('Queued from the browser');
    await tray.getByRole('button', { name: 'Edit', exact: true }).click();
    await tray.getByRole('textbox', { name: 'Edit queued message' }).fill('Edited from the browser');
    await tray.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(tray).toContainText('Edited from the browser');
    await tray.getByRole('button', { name: 'Remove queued message' }).click();
    await expect(tray).toHaveCount(0);
    await expect(row).toHaveAttribute('aria-current', 'page');
    await page.locator('.composer').getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(row).toContainText('Interrupted');
  } finally {
    if (threadId) await desktop.call('threads.stop', { threadId }).catch(() => {});
    desktop.close();
  }
});

test.describe('browser request cards', () => {
  test('a paired browser answers choices, confirmations and all four secret actions', async ({ page, baseURL }) => {
    test.setTimeout(60_000);
    const desktop = await TestClient.open(`${baseURL!.replace('http:', 'ws:')}/ws?token=relay-test-token`);
    let threadId: string | undefined;
    try {
      const profile = (await desktop.call('profiles.list', {})).find(({ name }) => name === 'Personal')!;
      const checkoutId = (await desktop.call('projects.get', {})).checkouts[0]!.id;
      const machineId = (await desktop.call('machines.list', {})).find(({ name }) => name === 'MacBook')!.id;
      const thread = await desktop.call('threads.start', { checkoutId, machineId, text: 'Browser request cards fixture' });
      threadId = thread.id;
      await desktop.call('secrets.save', { profileId: profile.id, name: 'Fixture saved credential', slot: 'browser:fixture:existing', projectIds: [], value: 'accio-browser-dummy-existing' });
      await openPairedHub(page, desktop);
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.locator('.sidebar nav').getByRole('button', { name: 'Sending', exact: true }).click();
      await page.getByRole('switch', { name: 'Move on after sending' }).uncheck();
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      const row = page.locator('.sidebar .row-main').filter({ hasText: 'Browser request cards fixture' }).first();
      await row.click();
      const input = page.locator('.composer textarea');
      const send = page.getByRole('button', { name: 'Send', exact: true });
      const stop = page.locator('.composer').getByRole('button', { name: 'Stop', exact: true });
      const say = async (text: string) => {
        await expect(stop).toHaveCount(0);
        await input.fill(text);
        await send.click();
      };
      await say('Browser choice fixture');
      const choice = page.locator('.choice').filter({ hasText: 'Which browser layout?' });
      await expect.poll(() => choice.getByRole('img', { name: 'Cards' }).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
      await choice.getByRole('button', { name: /Pick.*Cards/ }).click();
      await send.click();
      await expect(choice).toHaveClass(/answered/);
      await expect(page.locator('.msg.assistant').last()).toContainText('I pick B ("Cards") for "Which browser layout?"');

      const confirmation = page.getByRole('region', { name: /^Needs your answer: Add the project/ });
      const inboxRow = page.locator('.sidebar .row:not(.shelf .row) .row-main').filter({ hasText: 'Browser request cards fixture' }).first();
      await say('Browser confirmation fixture');
      await expect(confirmation).toBeVisible();
      await expect(inboxRow).toContainText('Needs your OK');
      await confirmation.getByRole('button', { name: 'Decline' }).click();
      await expect(page.locator('.msg.assistant').last()).toContainText('The user declined adding these projects.');
      await say('Browser confirmation fixture');
      await confirmation.getByRole('button', { name: 'Add project' }).click();
      await expect(page.locator('.msg.assistant').last()).toContainText('Added browser-card-fixture');

      for (const [action, button, result] of [['save', 'Save & use', 'provided'], ['once', 'Use once', 'provided'], ['existing', 'Use selected', 'provided'], ['decline', 'Decline', 'declined']] as const) {
        await say(`Browser secret fixture: ${action}`);
        await expect(inboxRow).toContainText('Needs a secret');
        const card = page.getByRole('region', { name: `Secret requested: Browser ${action} credential` });
        if (action === 'existing') await card.getByRole('radio', { name: /Fixture saved credential/ }).check();
        if (action === 'save' || action === 'once') await card.getByPlaceholder('Paste secret').fill(`accio-browser-dummy-${action}`);
        await card.getByRole('button', { name: button, exact: true }).click();
        await expect(page.locator('.msg.assistant').last()).toHaveText(`Secret ${action}: ${result}`);
        await expect(page.locator('.sidebar .row-state').filter({ hasText: 'Needs a secret' })).toHaveCount(0);
      }
      const delivered = (await desktop.call('threads.transcript', { threadId })).find(item => item.kind === 'secret');
      expect(delivered).toMatchObject({ projectName: 'relay-demo', projectId: expect.any(String) });
      const saved = await desktop.call('secrets.list', { profileId: profile.id });
      expect(saved.filter(({ slot }) => slot.startsWith('browser:fixture:')).map(({ slot, projectIds }) => ({ slot, projectIds })).sort((left, right) => left.slot.localeCompare(right.slot))).toEqual([
        { slot: 'browser:fixture:existing', projectIds: [delivered?.projectId] }, { slot: 'browser:fixture:save', projectIds: [delivered?.projectId] },
      ]);
    } finally {
      if (threadId) await desktop.call('threads.stop', { threadId }).catch(() => {});
      desktop.close();
    }
  });
});

test('a paired browser starts threads on an online machine from the hub URL', async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  const desktop = await TestClient.open(`${baseURL!.replace('http:', 'ws:')}/ws?token=relay-test-token`);
  let sleepingProfileId: string | undefined;
  try {
    const personal = await desktop.signedIn('Personal');
    await desktop.call('threads.start', { profileId: personal.id, text: 'Recent PC activity for browser defaults' });
    const { code, url } = await desktop.call('clients.createPairingCode', {});
    const hub = new URL('/', url ?? (await desktop.call('hubs.list', {}))[0]!.url).origin;
    const requests: string[] = [];
    page.on('websocket', (socket) => {
      if (!socket.url().endsWith('/client/relay')) return;
      socket.on('framesent', ({ payload }) => requests.push(JSON.parse(String(payload)).method));
    });
    await page.goto(`${hub}/#${code}`);
    await expect(page).toHaveURL(`${hub}/`);
    const sidebar = page.locator('.sidebar');
    const newThread = sidebar.getByRole('button', { name: 'New thread', exact: true });
    const choose = async (name: string) => {
      await newThread.click();
      await page.getByRole('option', { name, exact: true }).click();
    };
    const target = (name: string) => page.getByRole('button', { name: `Run on machine: ${name}`, exact: true });
    const send = async (text: string) => {
      await page.locator('.composer textarea').fill(text);
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(page.locator('.msg.user').last()).toContainText(text);
      await expect(sidebar.locator('.row-main').filter({ hasText: text }).locator('.row-machine')).toHaveText('PC');
      await expect(page.locator('.msg.assistant').last()).toContainText(`PC here. You said: ${text}`);
      await expect(sidebar.locator('.side-body > .rows .row-main').filter({ hasText: text })).toBeVisible({ timeout: 15_000 });
    };

    await expect(sidebar.getByText('Browser project history on the MacBook', { exact: true })).toBeVisible();
    await expect(sidebar.getByText('Recent PC activity for browser defaults', { exact: true })).toBeVisible();
    await choose('No project');
    const profileSearch = page.getByRole('combobox', { name: 'Search profiles' });
    if (await profileSearch.isVisible()) await page.getByRole('option', { name: 'Personal', exact: true }).click();
    await expect(target('PC')).toBeVisible();
    await send('Browser quick question on the PC');

    await choose('browser-project');
    await expect(target('MacBook')).toBeVisible();
    await target('MacBook').click();
    const pc = page.getByRole('menuitemradio', { name: /^PC/ });
    await expect(pc).toContainText('No checkout yet');
    await pc.click();
    await expect(target('PC')).toBeVisible();
    await send('Browser project thread cloned to the PC');
    const projects = await desktop.call('projects.get', {});
    const cloned = projects.projects.find(({ repoKey }) => repoKey === 'github.com/example/browser-project');
    expect(projects.checkouts).toContainEqual(expect.objectContaining({ projectId: cloned?.id }));

    await choose('hub-only');
    await expect(page.getByRole('heading', { name: 'What should we build in hub-only?' })).toBeVisible();
    await page.getByRole('button', { name: /^Run on machine:/ }).click();
    await expect(pc).toContainText('No checkout yet');
    await pc.click();
    await send('Browser thread in a hub-only project');
    expect(requests.filter((method) => method === 'threads.start')).toHaveLength(3);
    expect(requests.filter((method) => method?.startsWith('checkouts.'))).toEqual([]);

    await choose('mac-only');
    await expect(target('MacBook')).toBeVisible();
    sleepingProfileId = personal.id;
    await desktop.call('threads.start', { profileId: sleepingProfileId, text: 'Put the MacBook to sleep' });
    await expect(page.getByRole('button', { name: /^Run on machine: (PC|Old laptop)$/ })).toBeVisible();
    await desktop.call('threads.start', { profileId: personal.id, text: 'Wake the MacBook' });
    await expect(target('MacBook')).toBeVisible({ timeout: 15_000 });
    sleepingProfileId = undefined;

    await desktop.call('threads.start', { profileId: personal.id, text: 'Temporarily put all machines to sleep' });
    await expect(newThread).toBeDisabled();
    await expect(newThread).toHaveAccessibleDescription('No machines are online.');
    await expect(sidebar.getByRole('status').filter({ hasText: 'No machines are online.' })).toBeVisible();
    await expect(newThread).toBeEnabled({ timeout: 15_000 });
  } finally {
    if (sleepingProfileId) await desktop.call('threads.start', { profileId: sleepingProfileId, text: 'Wake the MacBook' }).catch(() => {});
    desktop.close();
  }
});
