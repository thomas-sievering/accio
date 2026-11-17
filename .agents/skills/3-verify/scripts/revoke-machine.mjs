import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { controls, createFirstProfile } from './steps.mjs';

// Offline: pairs a second disposable worker with this run's hub through its own first-run UI, then
// revokes it from Settings → Machines. No Sorting Hat is linked, so hat key deletion is the hub tests' proof.
export default async function revokeMachine({ page, context, runDir, action, capture }) {
  const { button, section } = controls(page);
  const second = fork('apps/worker/dist/main.js', [], {
    silent: true, windowsHide: true,
    env: { ...process.env, ACCIO_HOME: join(runDir, 'scratch', 'second-machine'), ACCIO_PORT: '0', ACCIO_HUB_PORT: '0', ACCIO_HOST: '127.0.0.1', ACCIO_WEB_ROOT: join(process.cwd(), 'apps/web/dist') },
  });
  let output = ''; second.stdout.on('data', (d) => { output += d; }); second.stderr.on('data', (d) => { output += d; });
  const other = await context.newPage();
  const row = (name) => page.locator('.machine-row').filter({ has: page.getByRole('button', { name, exact: true }) });
  try {
    const deadline = Date.now() + 45_000;
    while (!output.includes('ACCIO_READY ')) {
      assert(second.exitCode === null && Date.now() < deadline, `Second worker did not become ready: ${output.slice(-2000)}`);
      await new Promise((r) => setTimeout(r, 100));
    }
    const ready = JSON.parse(output.match(/ACCIO_READY (\{[^\r\n]+\})/)[1]);
    let address, code;
    await action('machines-onboard: generate a pairing code for this hub', async () => {
      await createFirstProfile(page);
      await button('Settings').click(); await section('Machines').click();
      await button('Add machine').click();
      address = await page.getByRole('textbox', { name: 'Hub address', exact: true }).inputValue();
      await button('Generate pairing code').click();
      code = await page.locator('.machine-onboard [role=status] code').innerText();
    });
    await action('hubs/first-run: pair the second machine and name it', async () => {
      await other.goto(ready.url + '/#token=' + ready.token);
      await other.getByRole('radio', { name: /^Remote hub/ }).click();
      await other.getByRole('button', { name: 'Continue', exact: true }).click();
      await other.getByRole('textbox', { name: 'Hub address', exact: true }).fill(address);
      await other.getByRole('textbox', { name: 'Pairing code', exact: true }).fill(code);
      await other.getByRole('button', { name: 'Connect hub', exact: true }).click();
      await other.getByRole('heading', { name: 'Join your hub', exact: true }).waitFor({ state: 'hidden', timeout: 20_000 });
      await other.getByRole('button', { name: 'Settings', exact: true }).click();
      await other.locator('.sidebar nav').getByRole('button', { name: 'Machines', exact: true }).click();
      await other.getByRole('button', { name: /\(this machine\)/ }).click();
      await other.getByRole('textbox', { name: /^Machine name/ }).fill('Spare machine');
      await other.getByRole('button', { name: 'Save', exact: true }).click();
      await other.locator('.crumbs').getByText('Spare machine').waitFor();
    });
    await action('machines/revoke: this machine offers no Revoke', async () => {
      await button('Done').click();
      await expect(row('Spare machine')).toContainText('Connected', { timeout: 15_000 });
      await page.getByRole('button', { name: /\(this machine\)/ }).click();
      await page.getByRole('textbox', { name: /^Machine name/ }).waitFor();
      assert.equal(await button('Revoke').count(), 0);
      await page.locator('.settings-actions').getByRole('button', { name: 'Cancel', exact: true }).click();
    });
    const confirm = page.getByRole('group', { name: 'Revoke Spare machine?', exact: true });
    await action('machines/revoke: Revoke names the machine and its consequence; Escape cancels', async () => {
      await button('Spare machine').click();
      await button('Revoke').click();
      await expect(confirm).toContainText('Spare machine loses access to Local dev, and its hat keys are deleted on the Sorting Hat. Its threads stay on that machine.');
      await expect(confirm).toContainText('it must be paired with a new code');
      await expect(confirm.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
      await capture('revoke-confirm');
      await page.keyboard.press('Escape');
      await expect(confirm).toHaveCount(0);
      await expect(page.getByRole('textbox', { name: /^Machine name/ })).toHaveValue('Spare machine');
    });
    await action('machines/revoke: confirming unpairs it; it shows Revoked and stays out', async () => {
      await button('Revoke').click();
      await confirm.getByRole('button', { name: 'Revoke Spare machine', exact: true }).click();
      await button('Add machine').waitFor();
      await expect(row('Spare machine')).toContainText('Revoked');
      await capture('revoked-list');
      await page.waitForTimeout(3_000); // the revoked worker keeps retrying its saved token
      await expect(row('Spare machine')).toContainText('Revoked');
      await button('Spare machine').click();
      await page.getByText('Spare machine no longer has access to Local dev. To use it again, pair it with a new code.', { exact: true }).waitFor();
      assert.equal(await button('Revoke').count(), 0);
      await other.locator('.sidebar nav').getByRole('button', { name: /^Hub: / }).click();
      await other.getByRole('menuitem', { name: 'Manage hubs' }).click();
      await other.getByRole('menu', { name: 'Choose hub', exact: true }).waitFor({ state: 'hidden' });
      await expect(other.locator('.setting').filter({ hasText: address })).toContainText('Offline');
      await expect(other.getByText('This machine is not paired with the hub.', { exact: true })).toBeVisible();
      await other.screenshot({ path: join(runDir, 'revoked-machine-hubs.png') });
    });
  } finally {
    await other.close();
    if (second.exitCode === null) { second.send({ type: 'shutdown' }); await once(second, 'exit'); }
  }
}
