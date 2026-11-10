import { createHash, randomBytes } from 'node:crypto';

/**
 * Claude OAuth with PKCE and Claude Code's public client. Production sign-in
 * supplies a machine-local callback (ADR 0013); the hosted redirect remains
 * the default for callers of the original library API.
 */
export const CLAUDE_OAUTH = {
  clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  authorizeUrl: 'https://claude.ai/oauth/authorize',
  tokenUrl: 'https://platform.claude.com/v1/oauth/token',
  redirectUri: 'https://platform.claude.com/oauth/code/callback',
  scopes: 'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload',
};

/** One sign-in in progress, including the exact redirect used in the token exchange. */
export type PendingSignIn = { verifier: string; state: string; url: string; redirectUri: string };

const b64url = (buf: Buffer) => buf.toString('base64url');

export function beginSignIn(random: (n: number) => Buffer = randomBytes, redirectUri = CLAUDE_OAUTH.redirectUri): PendingSignIn {
  const verifier = b64url(random(32));
  const state = b64url(random(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const params = new URLSearchParams({
    code: 'true',
    client_id: CLAUDE_OAUTH.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: CLAUDE_OAUTH.scopes,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  return { verifier, state, redirectUri, url: `${CLAUDE_OAUTH.authorizeUrl}?${params}` };
}

export class SignInError extends Error {}

/** How long any started sign-in stays open. */
export const SIGN_IN_TTL_MS = 15 * 60 * 1000;

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

/** A Claude account as the Sorting Hat keeps it: its tokens and who it is. */
export type ClaudeAccount = {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms; refreshed a few minutes before. */
  expiresAt: number;
  email: string | null;
  /** Anthropic account id; tells whether two accounts are the same Claude account. */
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

function toAccount(r: TokenResponse, previous: ClaudeAccount | null, now: number): ClaudeAccount {
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token ?? previous?.refreshToken ?? '',
    expiresAt: now + r.expires_in * 1000,
    email: r.account?.email_address ?? previous?.email ?? null,
    claudeAccountId: r.account?.uuid ?? previous?.claudeAccountId ?? null,
    organization: r.organization?.name ?? previous?.organization ?? null,
  };
}

export async function exchangeCode(fetchImpl: Fetch, pending: PendingSignIn, code: string, now = Date.now()): Promise<ClaudeAccount> {
  const r = await tokenRequest(fetchImpl, {
    grant_type: 'authorization_code',
    client_id: CLAUDE_OAUTH.clientId,
    code,
    state: pending.state,
    redirect_uri: pending.redirectUri,
    code_verifier: pending.verifier,
  });
  return toAccount(r, null, now);
}

export async function refreshAccount(fetchImpl: Fetch, account: ClaudeAccount, now = Date.now()): Promise<ClaudeAccount> {
  const r = await tokenRequest(fetchImpl, {
    grant_type: 'refresh_token',
    client_id: CLAUDE_OAUTH.clientId,
    refresh_token: account.refreshToken,
  });
  return toAccount(r, account, now);
}

/** Refresh this long before expiry so no request goes out with a token about to lapse. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export function needsRefresh(account: ClaudeAccount, now = Date.now()): boolean {
  return account.expiresAt - now < REFRESH_MARGIN_MS;
}
