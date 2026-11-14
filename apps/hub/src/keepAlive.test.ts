import { afterEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { keepAlive } from './keepAlive.js';

describe('keepAlive', () => {
  let server: WebSocketServer | undefined;
  afterEach(async () => { await new Promise((resolve) => server?.close(resolve) ?? resolve(undefined)); server = undefined; });

  async function connect(autoPong: boolean) {
    server = new WebSocketServer({ port: 0, autoPong });
    await new Promise((resolve) => server!.once('listening', resolve));
    const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as { port: number }).port}`);
    await new Promise((resolve) => ws.once('open', resolve));
    keepAlive(ws, 40);
    return ws;
  }

  it('closes a socket the hub stopped answering, as after this machine slept', async () => {
    const ws = await connect(false);
    await new Promise((resolve) => ws.once('close', resolve));
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });

  it('keeps a socket the hub answers', async () => {
    const ws = await connect(true);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.terminate();
  });

  async function serve(clientPongs: boolean) {
    server = new WebSocketServer({ port: 0 });
    await new Promise((resolve) => server!.once('listening', resolve));
    const accepted = new Promise<WebSocket>((resolve) => server!.once('connection', (peer) => { keepAlive(peer, 40, { endOnWake: false }); resolve(peer); }));
    const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as { port: number }).port}`, { autoPong: clientPongs });
    ws.on('error', () => {});
    return { ws, peer: await accepted };
  }

  it('closes a hub socket whose machine stopped answering pings', async () => {
    const { ws, peer } = await serve(false);
    await new Promise((resolve) => peer.once('close', resolve));
    expect(peer.readyState).toBe(WebSocket.CLOSED);
    ws.terminate();
  });

  it('keeps a hub socket whose machine answers pings', async () => {
    const { ws, peer } = await serve(true);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(peer.readyState).toBe(WebSocket.OPEN);
    ws.terminate();
  });
});
