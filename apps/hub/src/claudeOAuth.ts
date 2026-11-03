import { createHash, randomBytes } from 'node:crypto';

/**
 * Claude sign-in (ADR 0007): OAuth with PKCE, using Claude Code's public client
 * and Anthropic's hosted code page as the redirect, so you paste the code back
 * instead of the hub listening on a local port. Values match what pi and
 * CLIProxyAPI use.
 */
export const CLAUDE_OAUTH = {
  clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  authorizeUrl: 'https://claude.ai/oauth/authorize',
  tokenUrl: 'https://platform.claude.com/v1/oauth/token',
  redirectUri: 'https://platform.claude.com/oauth/code/callback',
  scopes: 'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload',
};

/** One sign-in in progress: what was sent, so the pasted code can be checked and exchanged. */
export type PendingSignIn = { verifier: string; state: string; url: string };

const b64url = (buf: Buffer) => buf.toString('base64url');

export function beginSignIn(random: (n: number) => Buffer = randomBytes): PendingSignIn {
  const verifier = b64url(random(32));
  const state = b64url(random(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const params = new URLSearchParams({
    code: 'true',
    client_id: CLAUDE_OAUTH.clientId,
    response_type: 'code',
    redirect_uri: CLAUDE_OAUTH.redirectUri,
    scope: CLAUDE_OAUTH.scopes,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  return { verifier, state, url: `${CLAUDE_OAUTH.authorizeUrl}?${params}` };
}

export class SignInError extends Error {}

/**
 * Reads what you pasted: Anthropic's page shows `code#state`; a full redirect
 * URL or a bare code also works. A state that doesn't match this sign-in is refused.
 */
export function readPastedCode(pasted: string, pending: PendingSignIn): string {
  const text = pasted.trim();
  if (!text) throw new SignInError('Paste the code from Claude’s page');
  let code: string | null = text;
  let state: string | null = null;
  if (/^https?:\/\//.test(text)) {
    const u = new URL(text);
    code = u.searchParams.get('code');
    state = u.searchParams.get('state') ?? (u.hash ? u.hash.slice(1) : null);
  } else if (text.includes('#')) {
    [code, state] = text.split('#', 2) as [string, string];
  }
  if (!code) throw new SignInError('That doesn’t contain a code');
  if (state !== null && state !== pending.state) {
    throw new SignInError('That code belongs to a different sign-in. Start again and paste the newest code.');
  }
  return code;
}

/** A provider login as the hub keeps it. */
export type ClaudeLogin = {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms; refreshed a few minutes before. */
  expiresAt: number;
  email: string | null;
  /** Anthropic account id; tells whether two accio profiles use the same Claude login. */
  claudeAccountId: string | null;
  organization: string | null;
};

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  account?: { uuid?: string; email_address?: string };
  organization?: { uuid?: string; name?: string };
};

export type Fetch = typeof fetch;

async function tokenRequest(fetchImpl: Fetch, body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetchImpl(CLAUDE_OAUTH.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try {
      const j = JSON.parse(text) as { error_description?: string; error?: string | { message?: string } };
      detail = j.error_description ?? (typeof j.error === 'string' ? j.error : j.error?.message) ?? detail;
    } catch {}
    throw new SignInError(`Claude refused the sign-in (${res.status}): ${detail}`);
  }
  return JSON.parse(text) as TokenResponse;
}

function toLogin(r: TokenResponse, previous: ClaudeLogin | null, now: number): ClaudeLogin {
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token ?? previous?.refreshToken ?? '',
    expiresAt: now + r.expires_in * 1000,
    email: r.account?.email_address ?? previous?.email ?? null,
    claudeAccountId: r.account?.uuid ?? previous?.claudeAccountId ?? null,
    organization: r.organization?.name ?? previous?.organization ?? null,
  };
}

export async function exchangeCode(fetchImpl: Fetch, pending: PendingSignIn, code: string, now = Date.now()): Promise<ClaudeLogin> {
  const r = await tokenRequest(fetchImpl, {
    grant_type: 'authorization_code',
    client_id: CLAUDE_OAUTH.clientId,
    code,
    state: pending.state,
    redirect_uri: CLAUDE_OAUTH.redirectUri,
    code_verifier: pending.verifier,
  });
  return toLogin(r, null, now);
}

export async function refreshLogin(fetchImpl: Fetch, login: ClaudeLogin, now = Date.now()): Promise<ClaudeLogin> {
  const r = await tokenRequest(fetchImpl, {
    grant_type: 'refresh_token',
    client_id: CLAUDE_OAUTH.clientId,
    refresh_token: login.refreshToken,
  });
  return toLogin(r, login, now);
}

/** Refresh this long before expiry so no request goes out with a token about to lapse. */
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export function needsRefresh(login: ClaudeLogin, now = Date.now()): boolean {
  return login.expiresAt - now < REFRESH_MARGIN_MS;
}
