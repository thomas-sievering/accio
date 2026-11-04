import assert from 'node:assert/strict';

// One-time: pair the verify device with a real hub through Settings-free first-run setup.
// ACCIO_VERIFY_HUB_URL and a fresh ACCIO_VERIFY_PAIRING_CODE (from a device already on that hub) are required.
export const link = process.env.ACCIO_VERIFY_HUB_URL;

export default async function linkHub({ page, action, capture }) {
  const code = process.env.ACCIO_VERIFY_PAIRING_CODE;
  assert(link && code, 'Set ACCIO_VERIFY_HUB_URL and ACCIO_VERIFY_PAIRING_CODE');
  const button = (name) => page.getByRole('button', { name, exact: true });
  await action('hubs/first-run: pair the verify device with the hub', async () => {
    await page.getByRole('radio', { name: /^Remote hub/ }).click();
    await button('Continue').click();
    await page.getByRole('textbox', { name: 'Hub address', exact: true }).fill(link);
    await page.getByRole('textbox', { name: 'Pairing code', exact: true }).fill(code);
    await button('Connect hub').click();
    await page.getByRole('heading', { name: 'Join your hub', exact: true }).waitFor({ state: 'hidden', timeout: 20_000 });
  });
  await action('machines/settings: name the verify device', async () => {
    await button('Settings').click();
    await page.locator('.sidebar nav').getByRole('button', { name: 'Machines', exact: true }).click();
    await page.getByRole('button', { name: /\(this machine\)/ }).click();
    await page.getByRole('textbox', { name: /^Machine name/ }).fill('Accio verify');
    await button('Save name').click();
    await page.getByRole('heading', { name: 'Accio verify', exact: true }).waitFor();
  });
  await capture('linked');
}
