import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { HubClient } from './client.js';

let server: Server | undefined;
afterEach(() => new Promise<void>((done) => server ? server.close(() => done()) : done()));

it('reports a proxy error page as an unavailable hub, not as broken JSON', async () => {
  server = createServer((_req, res) => { res.writeHead(502, { 'content-type': 'text/html' }); res.end('<!DOCTYPE html><html><body>Bad gateway</body></html>'); });
  await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done));
  const client = new HubClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 'hub', 'token', { id: 'm', name: 'm', platform: 'test', version: 'test', harnesses: [] });
  await expect(client.call('machine.references', { profiles: [] })).rejects.toThrow('Hub is unavailable (HTTP 502). Try again in a moment.');
  await client.close();
});
