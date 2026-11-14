import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RpcClient, type ConnectionStatus, type SocketLike } from './rpcClient';

class FakeSocket implements SocketLike {
  readyState = 0;
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  sent: { id: number; method: string }[] = [];
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.drop(); }
  open() { this.readyState = 1; this.onopen?.({}); }
  drop() { this.readyState = 3; this.onclose?.({}); }
  message(data: unknown) { this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) }); }
}

function setup(probe: 'unreachable' | 'unauthorized' = 'unreachable') {
  const sockets: FakeSocket[] = [];
  const statuses: ConnectionStatus[] = [];
  const client = new RpcClient('ws://worker/ws?token=t', {
    socket: () => { const s = new FakeSocket(); sockets.push(s); return s; },
    probe: async () => probe,
    callTimeoutMs: 1000,
  });
  client.onStatus((s) => statuses.push(s));
  return { client, sockets, statuses, last: () => sockets.at(-1)! };
}

describe('RpcClient', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('rejects a call the worker never answers and ignores the late answer', async () => {
    const { client, last } = setup();
    last().open();
    const call = client.call('hubs.list', {});
    const failed = expect(call).rejects.toThrow('The worker did not answer in time');
    await vi.advanceTimersByTimeAsync(1000);
    await failed;
    last().message({ type: 'response', id: last().sent[0]!.id, ok: true, result: [] });
    const next = client.call('hubs.list', {});
    last().message({ type: 'response', id: last().sent[1]!.id, ok: true, result: ['ok'] });
    await expect(next).resolves.toEqual(['ok']);
  });

  it('drops malformed messages and keeps handling later ones', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client, last } = setup();
    last().open();
    const events: unknown[] = [];
    client.onEvent('hubs.changed', (d) => events.push(d));
    const call = client.call('hubs.list', {});
    last().message('{not json');
    last().message({ type: 'response' });
    last().message({ type: 'event' });
    last().message(null);
    last().message({ type: 'event', event: 'hubs.changed', data: [] });
    last().message({ type: 'response', id: last().sent[0]!.id, ok: true, result: [] });
    await expect(call).resolves.toEqual([]);
    expect(events).toEqual([[]]);
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it('backs off between failed reconnects up to a cap and resets after connecting', async () => {
    const { sockets, last } = setup();
    const gaps: number[] = [];
    for (let i = 0; i < 9; i++) {
      const before = sockets.length;
      last().drop();
      let waited = 0;
      while (sockets.length === before) { await vi.advanceTimersByTimeAsync(100); waited += 100; }
      gaps.push(waited);
    }
    expect(gaps).toEqual([500, 1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    last().open();
    last().drop();
    await vi.advanceTimersByTimeAsync(500);
    expect(sockets).toHaveLength(11);
  });

  it('reports a worker that does not answer as unreachable', async () => {
    const { client, statuses, last } = setup('unreachable');
    last().drop();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.status).toBe('unreachable');
    expect(statuses).toEqual(['unreachable']);
  });

  it('reports a refused token as unauthorized', async () => {
    const { client, last } = setup('unauthorized');
    last().drop();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.status).toBe('unauthorized');
  });

  it('reports a dropped open connection as closed and fails its calls', async () => {
    const { client, last } = setup();
    last().open();
    const call = client.call('hubs.list', {});
    last().drop();
    await expect(call).rejects.toThrow('Connection lost');
    expect(client.status).toBe('closed');
  });
});
