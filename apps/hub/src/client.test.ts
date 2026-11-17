import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { HubClient } from './client.js';
import { accountInUse, providerAccounts } from '@accio/protocol';
import { HUB_PROTOCOL } from './service.js';

let server: Server | undefined;
afterEach(() => new Promise<void>((done) => server ? server.close(() => done()) : done()));

it.each(['refresh', 'call'] as const)('normalizes older hub profile accounts on %s before exposing the snapshot', async (entry) => {
  const account = { id: 'a', name: 'Claude', providerId: 'anthropic', signedIn: true, email: null, organization: null };
  const provider = { id: 'anthropic', name: 'Anthropic', accountName: 'Claude account', available: true, accounts: [account], accountIds: undefined as string[] | undefined, inUseId: 'a' };
  let snapshot = { hubId: 'hub', protocol: HUB_PROTOCOL, epoch: 'epoch', revision: 1,
    accounts: [account], profiles: [{ id: 'personal', name: 'Personal', house: null, providers: [provider] }] };
  server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(req.url === '/rpc' ? { result: null, snapshot } : snapshot));
  });
  await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done));
  const client = new HubClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 'hub', 'token', { id: 'm', name: 'm', platform: 'test', version: 'test', harnesses: [] });
  const read = () => entry === 'refresh' ? client.refresh() : client.call('machine.references', { profiles: [] });
  try {
    await read();
    const selected = client.snapshot.profiles[0].providers[0];
    expect(accountInUse(selected, client.snapshot.accounts)).toEqual(account);
    expect(providerAccounts(selected, client.snapshot.accounts)).toEqual([account]);
    expect(selected.accountIds).toEqual(['a']);
    expect(selected).not.toHaveProperty('accounts');

    // A newer hub's explicit empty selection wins over any leftover embedded accounts.
    snapshot = { ...snapshot, revision: 2, profiles: [{ ...snapshot.profiles[0], providers: [{ ...provider, accountIds: [] }] }] };
    await read();
    expect(accountInUse(client.snapshot.profiles[0].providers[0], client.snapshot.accounts)).toBeNull();
    expect(providerAccounts(client.snapshot.profiles[0].providers[0], client.snapshot.accounts)).toEqual([]);
  } finally { await client.close(); }
});

it('takes this machine’s GitHub account choice from an older hub that keeps it per machine', async () => {
  const machine = (id: string, login: string) => ({ id, name: id, platform: 'test', version: 'test', harnesses: [], lastSeen: '', profileFolders: {}, connected: true, profileGitHub: { personal: login } });
  const snapshot = { hubId: 'hub', protocol: HUB_PROTOCOL, epoch: 'epoch', revision: 1, accounts: [], machines: [machine('other', 'elsewhere'), machine('m', 'me')],
    profiles: [{ id: 'personal', name: 'Personal', house: null, providers: [] }, { id: 'work', name: 'Work', house: null, providers: [] }] };
  server = createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(snapshot)); });
  await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done));
  const client = new HubClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 'hub', 'token', { id: 'm', name: 'm', platform: 'test', version: 'test', harnesses: [] });
  try {
    await client.refresh();
    expect(client.snapshot.profiles.map((p) => p.githubLogin)).toEqual(['me', null]);
  } finally { await client.close(); }
});

it('reports a proxy error page as an unavailable hub, not as broken JSON', async () => {
  server = createServer((_req, res) => { res.writeHead(502, { 'content-type': 'text/html' }); res.end('<!DOCTYPE html><html><body>Bad gateway</body></html>'); });
  await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done));
  const client = new HubClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 'hub', 'token', { id: 'm', name: 'm', platform: 'test', version: 'test', harnesses: [] });
  await expect(client.call('machine.references', { profiles: [] })).rejects.toThrow('Hub is unavailable (HTTP 502). Try again in a moment.');
  await client.close();
});
