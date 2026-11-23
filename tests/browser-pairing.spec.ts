import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
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

async function browserHubLink(page: Page) {
  let down = false;
  const sockets = new Set<WebSocketRoute>();
  await page.route('**/client/state', (route) => down ? route.abort('internetdisconnected') : route.continue());
  await page.routeWebSocket(/\/client\/(relay|events)$/, (socket) => {
    if (down) { socket.close({ code: 1011 }); return; }
    const hub = socket.connectToServer();
    sockets.add(socket);
    socket.onClose((code, reason) => { sockets.delete(socket); hub.close({ code, reason }); });
    hub.onClose((code, reason) => { sockets.delete(socket); socket.close({ code, reason }); });
  });
  return {
    drop: (notify = true) => {
      down = true;
      if (notify) for (const socket of sockets) socket.close({ code: 1011 });
    },
    restore: () => { down = false; },
  };
}

test('a phone reconnects to the hub and catches up without reloading or duplicating items', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const link = await browserHubLink(page);
  const desktop = await TestClient.open(`${baseURL!.replace('http:', 'ws:')}/ws?token=relay-test-token`);
  let clientId: string | undefined;
  try {
    const known = new Set((await desktop.call('clients.list', {})).map(({ id }) => id));
    const profile = await desktop.signedIn('Browser reconnect fixture');
    const machineId = (await desktop.call('machines.list', {})).find(({ name }) => name === 'MacBook')!.id;
    const start = (text: string) => desktop.call('threads.start', { profileId: profile.id, machineId, text });
    const before = 'Browser reconnect original';
    const missed = 'Browser reconnect missed message';
    const inbox = 'Browser reconnect new inbox thread';
    const { id: threadId } = await start(before);
    await openPairedHub(page, desktop);
    const rows = page.locator('.sidebar .row-main');
    await rows.filter({ hasText: before }).click();
    clientId = (await desktop.call('clients.list', {})).find(({ id }) => !known.has(id))?.id;
    const assistant = page.locator('.msg.assistant');
    await expect(assistant.last()).toHaveText(`MacBook here. You said: ${before}`);
    const status = async (id: string) => (await desktop.call('threads.list', {})).find((thread) => thread.id === id)?.status;
    await expect.poll(() => status(threadId)).toBe('idle');
    const navigations: string[] = [];
    page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations.push(frame.url()); });

    link.drop();
    const notice = page.locator('.phone-navigation').getByRole('status');
    await expect(notice).toHaveText('Hub unreachable');
    await desktop.call('threads.send', { threadId, text: missed });
    const created = await start(inbox);
    await expect.poll(() => status(created.id)).toBe('idle');
    await expect.poll(() => status(threadId)).toBe('idle');
    await expect(notice).toHaveText('Hub unreachable');
    await expect(page.getByText(missed, { exact: true })).toHaveCount(0);
    await expect(rows.filter({ hasText: inbox })).toHaveCount(0);

    link.restore();
    await expect(notice).toHaveCount(0);
    const replies = [`MacBook here. You said: ${before}`, `MacBook here. You said: ${missed}`];
    await expect(assistant).toHaveText(replies);
    for (const wake of ['online', 'visibilitychange', 'pageshow'] as const) {
      if (wake === 'online') link.drop(false);
      const relay = page.waitForEvent('websocket', { predicate: (socket) => socket.url().endsWith('/client/relay') });
      await page.evaluate((event) => {
        if (event === 'visibilitychange') document.dispatchEvent(new Event(event));
        else if (event === 'pageshow') window.dispatchEvent(new PageTransitionEvent(event, { persisted: true }));
        else window.dispatchEvent(new Event(event));
      }, wake);
      if (wake === 'online') {
        await expect(notice).toHaveText('Hub unreachable');
        link.restore();
      }
      await relay;
      await expect(notice).toHaveCount(0);
      await expect(assistant).toHaveText(replies);
    }
    await expect(page.locator('.msg.user')).toHaveText([before, missed]);
    await page.getByRole('button', { name: 'Inbox', exact: true }).click();
    const newThread = rows.filter({ hasText: inbox });
    await expect(newThread).toHaveCount(1);
    await expect(newThread).toBeVisible();
    expect(navigations).toEqual([]);

    await test.step('Unpair during a second outage and return to pairing on reconnect', async () => {
      expect(clientId).toBeDefined();
      link.drop();
      await expect(page.locator('.connection-notice')).toHaveText('Hub unreachable');
      await desktop.call('clients.unpair', { clientId: clientId! });
      clientId = undefined;
      await expect(page.locator('.connection-notice')).toHaveText('Hub unreachable');
      link.restore();
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
      await expect(page.getByRole('heading', { name: 'Pair this browser' })).toBeVisible();
      await expect(page.locator('.sidebar')).toHaveCount(0);
    });
  } finally {
    if (clientId) await desktop.call('clients.unpair', { clientId }).catch(() => {});
    desktop.close();
  }
});

test('pairs by code or QR, keeps preferences in this browser, and unpairs from either client', async ({ browser, page, baseURL }, info) => {
  await page.goto(`${baseURL}/#token=relay-test-token`);
  await expect(page.getByRole('button', { name: 'This browser', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add project', exact: true })).toBeVisible();
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
  const tablet = await browser.newContext({ userAgent: 'iPad Version/18.0 Safari/604.1', viewport: { width: 1280, height: 900 } });
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
    const openBrowserSheet = async (tab: Page) => {
      await expect(tab.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
      await expect(tab.getByRole('button', { name: 'Add project', exact: true })).toHaveCount(0);
      await expect(tab.getByRole('button', { name: /^(Pick folder|Update|App screenshot)$/i })).toHaveCount(0);
      await tab.getByRole('button', { name: 'This browser', exact: true }).click();
      return tab.getByRole('dialog', { name: 'This browser' });
    };
    const typedSheet = await openBrowserSheet(typed);
    await expect(typedSheet.getByText('iPhone Safari', { exact: true })).toBeVisible();
    const theme = typedSheet.getByRole('combobox', { name: 'Theme' });
    const moveOn = typedSheet.getByRole('switch', { name: 'Move on after sending' });
    await expect(theme).toHaveValue('dark');
    await expect(moveOn).toBeChecked();
    await theme.selectOption('light');
    await expect(typed.locator('html')).toHaveCSS('color-scheme', 'light');
    await moveOn.uncheck();
    await typed.reload();
    await openBrowserSheet(typed);
    await expect(theme).toHaveValue('light');
    await expect(typed.locator('html')).toHaveCSS('color-scheme', 'light');
    await expect(moveOn).not.toBeChecked();
    await typed.screenshot({ path: info.outputPath('this-browser-light.png') });
    await typedSheet.getByRole('button', { name: 'Close', exact: true }).click();
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
    await scanned.locator('.sidebar .row-main').filter({ hasText: 'Hello from the MacBook' }).click();
    const project = scanned.getByRole('button', { name: 'relay-demo', exact: true });
    await project.click({ button: 'right', timeout: 5000 });
    await expect(scanned.getByRole('menuitem', { name: /Open in Explorer|Project settings/i })).toHaveCount(0);
    await project.click();
    await expect(scanned.getByRole('heading', { name: 'relay-demo' })).toBeVisible();
    await expect(scanned.getByRole('button', { name: 'relay-demo settings' })).toHaveCount(0);
    await scanned.getByRole('button', { name: 'Close dashboard' }).click();
    await scanned.locator('.side-foot').getByRole('button', { name: 'Limits', exact: true }).click();
    await expect(scanned.getByRole('heading', { name: 'Limits', exact: true })).toBeVisible();
    await expect(scanned.getByRole('button', { name: /Sign in|settings$/i })).toHaveCount(0);
    await scanned.getByRole('button', { name: 'Close limits', exact: true }).click();
    const scannedClients = await openBrowserSheet(scanned);
    await expect(scannedClients.getByRole('combobox', { name: 'Theme' })).toHaveValue('dark');
    await expect(scannedClients.getByRole('switch', { name: 'Move on after sending' })).toBeChecked();
    await expect(scannedClients.getByText('iPad Safari', { exact: true })).toBeVisible();
    await scannedClients.getByRole('button', { name: 'Unpair iPhone Safari' }).click();
    await scannedClients.getByRole('group', { name: 'Unpair iPhone Safari?' }).getByRole('button', { name: 'Unpair iPhone Safari' }).click();
    await expect(scannedClients.getByRole('button', { name: 'Unpair iPhone Safari' })).toHaveCount(0);
    await expect(clients.getByRole('button', { name: 'Unpair iPhone Safari' })).toHaveCount(0);
    await expect(typed.getByRole('heading', { name: pairing })).toBeVisible();

    await scannedClients.getByRole('button', { name: 'Unpair', exact: true }).click();
    const confirm = scannedClients.getByRole('group', { name: 'Unpair this browser?' });
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Unpair', exact: true }).click();
    await expect(clients.getByText('No paired clients yet')).toBeVisible();
    await expect(scanned.getByRole('heading', { name: pairing })).toBeVisible();

    const thirdCode = await makeCode('Generate new browser code', secondCode);
    await typed.getByRole('textbox', { name: 'Pairing code' }).fill(thirdCode);
    await typed.getByRole('button', { name: 'Pair browser', exact: true }).click();
    await expect(typed.locator('.sidebar')).toBeVisible();
    await clients.getByRole('button', { name: 'Unpair iPhone Safari' }).click();
    await clients.getByRole('group', { name: 'Unpair iPhone Safari?' }).getByRole('button', { name: 'Unpair iPhone Safari' }).click();
    await expect(clients.getByText('No paired clients yet')).toBeVisible();
    await expect(typed.getByRole('heading', { name: pairing })).toBeVisible();
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
    await expect(tab.locator('.composer textarea')).toHaveAttribute('placeholder', 'Message the running turn…');
    await expect(tab.locator('.msg.user').last()).toContainText('A long browser fixture turn');
    await expect(tab.locator('.msg.assistant').last()).toContainText('MacBook here. You said: A long browser fixture turn', { timeout: 15_000 });
    const form = tab.locator('.composer');
    await form.locator('textarea').evaluate((textarea) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['image'], 'image.png', { type: 'image/png' }));
      textarea.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
    });
    await expect(form.locator('.composer-image, .composer-error')).toHaveCount(0);
    await expect(form.getByRole('button', { name: 'Open app', exact: true })).toHaveCount(0);
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
      await page.getByRole('button', { name: 'This browser', exact: true }).click();
      const browserSheet = page.getByRole('dialog', { name: 'This browser' });
      await browserSheet.getByRole('switch', { name: 'Move on after sending' }).uncheck();
      await browserSheet.getByRole('button', { name: 'Close', exact: true }).click();
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
