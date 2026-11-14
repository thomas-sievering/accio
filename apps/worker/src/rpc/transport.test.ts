import { afterEach, expect, test, vi } from 'vitest';
import WebSocket from 'ws';
import type { ResponseEnvelope } from '@accio/protocol';
import { Router } from './router.js';
import { startTransport } from './transport.js';

/** A router that fails unexpectedly on its first message, then answers. */
class FlakyRouter extends Router {
  calls = 0;
  override async handle(raw: unknown): Promise<ResponseEnvelope | undefined> {
    if (this.calls++ === 0) throw new Error('router broke');
    return { type: 'response', id: (raw as { id: number }).id, ok: true, result: 'fine' };
  }
}

let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; vi.restoreAllMocks(); });

test('an error while handling a message is answered and the socket stays usable', async () => {
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
