import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHubService } from '../apps/hub/src/index.js';
import { fakeClaudeFetch, startTestSortingHat, TestClient } from '../apps/worker/src/testing/testApp.js';

/** Real hub switching; the transport holds model replies to expose a stale cached paint. */
test('model pickers keep identical profile IDs isolated across hubs', async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  const home = await mkdtemp(join(tmpdir(), 'accio-model-hub-'));
  const hat = await startTestSortingHat(home, { claudeFetch: (url, init) => String(url).endsWith('/api/oauth/usage') ? Promise.resolve(Response.json({ rate_limits_available: false })) : fakeClaudeFetch(url, init) });
  const other = await startHubService({ home, port: 0, secretKey: Buffer.alloc(32, 17).toString('base64') });
  const address = `${baseURL!.replace('http:', 'ws:')}/ws?token=isolated-chat-test-token`;
  const root = await TestClient.open(address);
  const original = (await root.call('hubs.list', {}))[0]!;
  let pairedId: string | undefined;
  try {
    const { code } = await other.createPairingCode();
    const paired = await root.call('hubs.pair', { name: 'Model isolation hub', url: other.url, code });
    pairedId = paired.id;
    const client = await TestClient.open(`${address}&hub=${paired.id}`);
    try {
      await client.call('sortingHat.configure', { url: hat.url, adminToken: hat.adminToken, hubName: 'Model isolation hub' });
      expect((await client.signedIn('Personal')).id).toBe('personal');
      const folder = join(home, 'other-project');
      await mkdir(folder);
      await client.call('checkouts.add', { path: folder, profileId: 'personal' });
    } finally { client.close(); }
    await page.addInitScript(id => localStorage.setItem('accio.hub', id), original.id);
    let holdOther = true;
    const release: (() => void)[] = [];
    await page.routeWebSocket('**/ws?*', socket => {
      const server = socket.connectToServer();
      const second = new URL(socket.url()).searchParams.get('hub') === paired.id;
      const modelRequests = new Set<number>();
      socket.onMessage(message => {
        const request = JSON.parse(String(message));
        if (request.method === 'models.list') {
          modelRequests.add(request.id);
          if (second && holdOther) { release.push(() => server.send(message)); return; }
        }
        server.send(message);
      });
      server.onMessage(message => {
        const response = JSON.parse(String(message));
        if (response.type === 'response' && response.ok && modelRequests.has(response.id)) {
          response.result.models = response.result.models.map((model: Record<string, unknown>) => ({ ...model, name: second ? 'Beta model' : 'Alpha model' }));
          socket.send(JSON.stringify(response));
        } else socket.send(message);
      });
    });
    const draft = async () => {
      await page.locator('.sidebar').getByRole('button', { name: 'New thread', exact: true }).click();
      await page.getByRole('option', { name: 'No project', exact: true }).click();
      if (await page.getByRole('combobox', { name: 'Search profiles' }).isVisible()) await page.getByRole('option', { name: 'Personal', exact: true }).click();
    };
    await page.goto(`${baseURL}/#token=isolated-chat-test-token`);
    await draft();
    await expect(page.getByRole('button', { name: 'Select model: Alpha model', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: `Hub: ${original.name}`, exact: true }).click();
    await page.getByRole('menuitemradio', { name: /^Model isolation hub/ }).click();
    await draft();
    await expect.poll(() => release.length).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: /^Select model:/ })).not.toHaveAttribute('aria-label', 'Select model: Alpha model');
    holdOther = false;
    release.splice(0).forEach(send => send());
    await expect(page.getByRole('button', { name: 'Select model: Beta model', exact: true })).toBeVisible();
  } finally {
    if (pairedId) await root.call('hubs.remove', { id: pairedId }).catch(() => {});
    root.close();
    await other.close();
    await hat.close();
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
