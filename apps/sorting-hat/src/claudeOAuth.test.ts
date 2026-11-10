import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CLAUDE_OAUTH, beginSignIn, exchangeCode, needsRefresh, readPastedCode, refreshAccount, type Fetch } from './claudeOAuth.js';

const pending = beginSignIn();

describe('beginSignIn', () => {
  it('builds a PKCE consent URL that redirects to Anthropic’s code page', () => {
    const u = new URL(pending.url);
    expect(`${u.origin}${u.pathname}`).toBe(CLAUDE_OAUTH.authorizeUrl);
    expect(u.searchParams.get('redirect_uri')).toBe(CLAUDE_OAUTH.redirectUri);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('code_challenge')).toBe(createHash('sha256').update(pending.verifier).digest('base64url'));
    expect(u.searchParams.get('state')).toBe(pending.state);
    // The verifier itself must never appear in the URL.
    expect(pending.url).not.toContain(pending.verifier);
  });
});

describe('readPastedCode', () => {
  it('accepts code#state, a redirect URL, or a bare code', () => {
    expect(readPastedCode(`abc#${pending.state}`, pending)).toBe('abc');
    expect(readPastedCode(`  ${CLAUDE_OAUTH.redirectUri}?code=xyz&state=${pending.state} `, pending)).toBe('xyz');
    expect(readPastedCode('plain-code', pending)).toBe('plain-code');
  });

  it('refuses a code from another sign-in, and empty input', () => {
    expect(() => readPastedCode('abc#other-state', pending)).toThrow(/different sign-in/);
    expect(() => readPastedCode('   ', pending)).toThrow(/Paste the code/);
  });
});

function fakeTokenEndpoint(reply: (body: Record<string, string>) => { status: number; json: unknown }) {
  const calls: Record<string, string>[] = [];
  const f: Fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    calls.push(body);
    const { status, json } = reply(body);
    return new Response(JSON.stringify(json), { status });
  };
  return { f, calls };
}

describe('token exchange', () => {
  it('exchanges the code with the verifier and keeps who signed in', async () => {
    const { f, calls } = fakeTokenEndpoint(() => ({
      status: 200,
      json: {
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: 3600,
        account: { uuid: 'acc-1', email_address: 'me@example.com' },
        organization: { name: 'HRC' },
      },
    }));
    const account = await exchangeCode(f, pending, 'the-code', 1000);
    expect(calls[0]).toMatchObject({ grant_type: 'authorization_code', code: 'the-code', code_verifier: pending.verifier });
    expect(account).toEqual({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: 1000 + 3600_000,
      email: 'me@example.com',
      claudeAccountId: 'acc-1',
      organization: 'HRC',
    });
  });

  it('keeps identity and the old refresh token when a refresh omits them', async () => {
    const { f } = fakeTokenEndpoint(() => ({ status: 200, json: { access_token: 'at2', expires_in: 60 } }));
    const old = { accessToken: 'at', refreshToken: 'rt', expiresAt: 0, email: 'me@x', claudeAccountId: 'a', organization: null };
    expect(await refreshAccount(f, old, 0)).toMatchObject({ accessToken: 'at2', refreshToken: 'rt', email: 'me@x', expiresAt: 60_000 });
  });

  it('reports Claude’s reason when it refuses', async () => {
    const { f } = fakeTokenEndpoint(() => ({ status: 400, json: { error: 'invalid_grant', error_description: 'Code expired' } }));
    await expect(exchangeCode(f, pending, 'old')).rejects.toThrow(/Code expired/);
  });

  it('refreshes five minutes before expiry', () => {
    const account = { accessToken: '', refreshToken: '', expiresAt: 10 * 60_000, email: null, claudeAccountId: null, organization: null };
    expect(needsRefresh(account, 4 * 60_000)).toBe(false);
    expect(needsRefresh(account, 6 * 60_000)).toBe(true);
  });
});
