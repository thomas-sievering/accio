import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { ResponseEnvelope } from '@accio/protocol';
import { Router } from './router.js';
import { startTransport } from './transport.js';

let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; vi.restoreAllMocks(); });

describe('transport token probe', () => {
  it('answers a plain GET to the socket path with whether the token is valid', async () => {
    const transport = await startTransport({ host: '127.0.0.1', port: 0, token: 'secret', router: { handle: async () => null } as unknown as Router });
    close = transport.close;
    const base = `http://127.0.0.1:${transport.port}/ws`;
    expect((await fetch(`${base}?token=secret`)).status).toBe(204);
    expect((await fetch(`${base}?token=wrong`)).status).toBe(401);
    expect((await fetch(base)).status).toBe(401);
  });
});

/** A router that fails unexpectedly on its first message, then answers. */
class FlakyRouter extends Router {
  calls = 0;
  override async handle(raw: unknown): Promise<ResponseEnvelope | undefined> {
    if (this.calls++ === 0) throw new Error('router broke');
    return { type: 'response', id: (raw as { id: number }).id, ok: true, result: 'fine' };
  }
}

describe('transport errors', () => {
  it('answers an error while handling a message and keeps the socket usable', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const transport = await startTransport({ host: '127.0.0.1', port: 0, token: 't', router: new FlakyRouter() });
    close = transport.close;
    const ws = new WebSocket(`ws://127.0.0.1:${transport.port}/ws?token=t`);
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const replies: ResponseEnvelope[] = [];
    ws.on('message', (data) => replies.push(JSON.parse(String(data))));
    const reply = async (id: number) => {
      ws.send(JSON.stringify({ id, method: 'threads.list', params: {} }));
      await vi.waitFor(() => expect(replies.find((r) => r.id === id)).toBeDefined());
      return replies.find((r) => r.id === id)!;
    };

    expect(await reply(1)).toMatchObject({ id: 1, ok: false });
    expect(errors).toHaveBeenCalled();
    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(await reply(2)).toMatchObject({ id: 2, ok: true, result: 'fine' });
    ws.close();
  });
});

describe('transport start', () => {
  it('holds sockets until the workspaces it serves are ready', async () => {
    let ready!: () => void;
    const router = { handle: async (raw: { id: number }) => ({ type: 'response', id: raw.id, ok: true, result: 'answered' }) } as unknown as Router;
    const transport = await startTransport({ host: '127.0.0.1', port: 0, token: 't', router, ready: new Promise<void>((resolve) => { ready = resolve; }) });
    close = transport.close;
    const ws = new WebSocket(`ws://127.0.0.1:${transport.port}/ws?token=t`);
    let open = false;
    ws.once('open', () => { open = true; });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(open).toBe(false);
    ready();
    await vi.waitFor(() => expect(open).toBe(true));
    const reply = new Promise<ResponseEnvelope>((resolve) => ws.once('message', (data) => resolve(JSON.parse(String(data)))));
    ws.send(JSON.stringify({ id: 1, method: 'threads.list', params: {} }));
    expect(await reply).toMatchObject({ id: 1, ok: true, result: 'answered' });
    ws.close();
  });
});
