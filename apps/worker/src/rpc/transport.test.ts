import { afterEach, describe, expect, it } from 'vitest';
import { startTransport } from './transport.js';
import type { Router } from './router.js';

describe('transport token probe', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => { await close?.(); close = undefined; });

  it('answers a plain GET to the socket path with whether the token is valid', async () => {
    const transport = await startTransport({ host: '127.0.0.1', port: 0, token: 'secret', router: { handle: async () => null } as unknown as Router });
    close = transport.close;
    const base = `http://127.0.0.1:${transport.port}/ws`;
    expect((await fetch(`${base}?token=secret`)).status).toBe(204);
    expect((await fetch(`${base}?token=wrong`)).status).toBe(401);
    expect((await fetch(base)).status).toBe(401);
  });
});
