import { createServer, type Server } from 'node:http';
import type { HubClient } from '@accio/hub';
import { UserError } from '../rpc/router.js';

type Attempt = { server?: Server; timer: ReturnType<typeof setTimeout> };

/** Short-lived code callbacks only. Provider tokens are exchanged and stored by the hub. */
export class BrowserSignIns {
  private attempts = new Map<string, Attempt>();
  constructor(private client: HubClient) {}
  get busy() { return this.attempts.size > 0; }
  async begin(accountId: string): Promise<{ signInId: string; url: string }> {
    const account = this.client.snapshot.accounts.find((a) => a.id === accountId);
    if (!account) throw new UserError('No such account');
    if (this.busy) throw new UserError('Finish or cancel the current sign-in before starting another.');
    let signInId: string | undefined;
    let expectedState: string | null = null;
    let path = '/callback';
    let used = false;
    const server = createServer((req, res) => { void (async () => {
      const callback = new URL(req.url ?? '/', 'http://localhost');
      if (req.method !== 'GET' || callback.pathname !== path || !signInId || used || !expectedState || callback.searchParams.get('state') !== expectedState) {
        res.writeHead(400, { 'content-type': 'text/plain', 'cache-control': 'no-store' }).end('This callback does not match an active Accio sign-in.'); return;
      }
      const code = callback.searchParams.get('code');
      if (!code || code.length > 16_384) { res.writeHead(400).end('Sign-in was not approved. Return to Accio and try again.'); return; }
      used = true;
      try {
        await this.client.call('accounts.callback', { signInId, code: account.providerId === 'anthropic' ? `${code}#${expectedState}` : code, state: expectedState });
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", 'referrer-policy': 'no-referrer' })
          .end('<!doctype html><title>Accio sign-in</title><h1>Return to Accio</h1><p>Your sign-in has been received. You can close this tab.</p>');
        this.finish(signInId);
      } catch { res.writeHead(400, { 'content-type': 'text/plain', 'cache-control': 'no-store' }).end('Sign-in could not finish. Return to Accio and try again.'); this.finish(signInId); }
    })().catch(() => { if (!res.headersSent) res.writeHead(500).end(); else res.destroy(); }); });
    try {
      let redirectUri: string | undefined;
      if (account.providerId === 'anthropic') {
        await listen(server, 0);
        redirectUri = `http://localhost:${(server.address() as any).port}/callback`;
      }
      const result = await this.client.call<{ signInId: string; url: string }>('accounts.beginSignIn', { id: accountId, ...(redirectUri ? { redirectUri } : {}) });
      signInId = result.signInId;
      const authorize = new URL(result.url);
      expectedState = authorize.searchParams.get('state');
      if (account.providerId === 'openai' && authorize.searchParams.has('redirect_uri')) {
        const callback = new URL(authorize.searchParams.get('redirect_uri')!);
        if (!['localhost', '127.0.0.1'].includes(callback.hostname) || callback.protocol !== 'http:' || callback.pathname !== '/auth/callback' || !callback.port || callback.username || callback.password || callback.search || callback.hash) throw new UserError('Unsupported ChatGPT browser callback');
        path = callback.pathname;
        if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(this.client.url).hostname)) await listen(server, Number(callback.port));
      }
      const timer = setTimeout(() => { this.finish(result.signInId); void this.client.call('accounts.cancelSignIn', { signInId: result.signInId }).catch(() => {}); }, 15 * 60_000);
      timer.unref();
      this.attempts.set(result.signInId, { ...(server.listening ? { server } : {}), timer });
      return result;
    } catch (error) {
      server.close();
      if (signInId) await this.client.call('accounts.cancelSignIn', { signInId }).catch(() => {});
      throw error;
    }
  }
  finish(id: string) { const attempt = this.attempts.get(id); if (!attempt) return; this.attempts.delete(id); clearTimeout(attempt.timer); attempt.server?.close(); }
  async close() { for (const id of this.attempts.keys()) { this.finish(id); await this.client.call('accounts.cancelSignIn', { signInId: id }).catch(() => {}); } }
}

async function listen(server: Server, port: number) {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
}
