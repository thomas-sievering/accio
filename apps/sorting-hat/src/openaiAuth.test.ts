import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { CodexClient } from './codex.js';
import { OpenAIAuth } from './openaiAuth.js';

it('finishes numeric-loopback logins internally without returning a token-bearing success redirect', async () => {
  const home = await mkdtemp(join(tmpdir(), 'accio-browser-callback-'));
  const paths: string[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost'); paths.push(url.pathname);
    if (url.pathname === '/auth/callback') res.writeHead(302, { location: '/success?access_token=private-token' }).end();
    else res.end('complete');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const callback = `http://127.0.0.1:${(server.address() as any).port}/auth/callback`;
  const url = 'https://auth.openai.com/oauth/authorize?' + new URLSearchParams({ state: 'expected', redirect_uri: callback });
  const client = { request: async () => ({ loginId: 'native', authUrl: url }), onNotification: () => () => {}, onExit: () => () => {}, close: async () => {} } as unknown as CodexClient;
  const auth = new OpenAIAuth(home, async () => client);
  try {
    const login = await auth.begin(true);
    await expect(auth.callback(login.signInId, 'code', 'wrong')).rejects.toThrow(/does not match/);
    expect(paths).toEqual([]);
    expect(await auth.callback(login.signInId, 'code', 'expected')).toBeUndefined();
    expect(paths).toEqual(['/auth/callback', '/success']);
    await expect(auth.callback(login.signInId, 'code', 'expected')).rejects.toThrow(/no longer waiting/);
  } finally {
    await auth.close(); await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  }
});
