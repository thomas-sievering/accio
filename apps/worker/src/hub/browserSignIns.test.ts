import { createServer } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import type { HubClient } from '@accio/hub';
import { BrowserSignIns } from './browserSignIns.js';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture(local: boolean) {
  const existing = createServer((_req, res) => res.end('native app-server callback'));
  await new Promise<void>((resolve) => existing.listen(0, '127.0.0.1', resolve));
  const port = (existing.address() as any).port;
  await new Promise<void>((resolve) => existing.close(() => resolve()));
  const calls: { method: string; params: any }[] = [];
  const authorize = new URL('https://auth.openai.com/oauth/authorize');
  authorize.search = new URLSearchParams({ state: 'expected-state', redirect_uri: `http://127.0.0.1:${port}/auth/callback` }).toString();
  const client = {
    url: local ? 'http://127.0.0.1:47323' : 'https://hub.example.test',
    snapshot: { accounts: [{ id: 'account', providerId: 'openai' }] },
    async call(method: string, params: any) {
      calls.push({ method, params });
      return method === 'accounts.beginSignIn' ? { signInId: 'attempt', url: authorize.href } : null;
    },
  } as unknown as HubClient;
  const signIns = new BrowserSignIns(client); cleanup.push(() => signIns.close());
  return { signIns, calls, port, existing };
}

it('relays a numeric-loopback callback to its initiating remote hub only after checking state', async () => {
  const { signIns, calls, port } = await fixture(false);
  await signIns.begin('account');
  const url = `http://127.0.0.1:${port}/auth/callback`;
  expect((await fetch(url + '?code=short-code&state=wrong')).status).toBe(400);
  expect(calls.filter((c) => c.method === 'accounts.callback')).toEqual([]);
  const response = await fetch(url + '?code=short-code&state=expected-state');
  expect(response.status).toBe(200);
  expect(await response.text()).not.toContain('short-code');
  expect(calls.at(-1)).toEqual({ method: 'accounts.callback', params: { signInId: 'attempt', code: 'short-code', state: 'expected-state' } });
  expect(signIns.busy).toBe(false);
});

it('leaves the native local app-server callback port available and closes cancelled remote listeners', async () => {
  const native = await fixture(true); await native.signIns.begin('account');
  await new Promise<void>((resolve, reject) => { native.existing.once('error', reject); native.existing.listen(native.port, '127.0.0.1', resolve); });
  cleanup.push(() => new Promise<void>((resolve) => native.existing.close(() => resolve())));
  expect(await fetch(`http://127.0.0.1:${native.port}/auth/callback`).then((r) => r.text())).toContain('native app-server');
  const remote = await fixture(false); await remote.signIns.begin('account'); await remote.signIns.close();
  await expect(fetch(`http://127.0.0.1:${remote.port}/auth/callback`)).rejects.toThrow();
  expect(remote.calls.at(-1)?.method).toBe('accounts.cancelSignIn');
});
