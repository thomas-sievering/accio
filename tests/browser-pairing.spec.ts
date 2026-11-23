import { expect, test } from '@playwright/test';
import jsQR from 'jsqr';

test('pairs browsers by typing a code or opening the QR URL and unpairs them from either client', async ({ browser, page, baseURL }) => {
  await page.goto(`${baseURL}/#token=relay-test-token`);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('.sidebar nav').getByRole('button', { name: 'Machines', exact: true }).click();
  const clients = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Paired clients', exact: true }) });
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
    const paired = "You're paired with Accio";
    await typed.goto(hub);
    await expect(typed.getByRole('heading', { name: pairing })).toBeVisible();
    await expect(typed.getByRole('heading', { name: 'Paired clients' })).toHaveCount(0);
    await typed.getByRole('textbox', { name: 'Pairing code' }).fill(firstCode);
    await typed.getByRole('button', { name: 'Pair browser', exact: true }).click();
    await expect(typed.getByRole('heading', { name: paired })).toBeVisible();
    await expect(typed.getByText('iPhone Safari', { exact: true })).toBeVisible();
    expect(await typed.evaluate(() => document.cookie)).not.toContain('accio-client');
    expect((await phone.cookies(hub)).find(({ name }) => name === '__Host-accio-client')).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict' });
    await typed.route('https://outside.example/', (route) => route.fulfill({ contentType: 'text/html', body: `<a href="${hub}">Open Accio</a>` }));
    await typed.goto('https://outside.example/');
    await typed.getByRole('link', { name: 'Open Accio' }).click();
    await expect(typed.getByRole('heading', { name: paired })).toBeVisible();
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
    await expect(scanned.getByRole('heading', { name: paired })).toBeVisible();
    await expect(scanned).toHaveURL(`${hub}/`);
    await scanned.getByRole('button', { name: 'Unpair iPhone Safari' }).click();
    await expect(scanned.getByRole('button', { name: 'Unpair iPhone Safari' })).toHaveCount(0);
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
