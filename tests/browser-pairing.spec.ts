import { expect, test, type Page } from '@playwright/test';
import jsQR from 'jsqr';
import { TestClient } from '../apps/worker/src/testing/testApp.js';

async function pairedClients(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('.sidebar nav').getByRole('button', { name: 'Machines', exact: true }).click();
  return page.locator('section').filter({ has: page.getByRole('heading', { name: 'Paired clients', exact: true }) });
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
