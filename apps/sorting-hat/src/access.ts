import { createPublicKey, verify, type JsonWebKeyInput, type KeyObject } from 'node:crypto';
import type { Fetch } from './types.js';

/** How a Cloudflare Access application is recognised: its team domain and its audience (AUD) tag. */
export type AccessConfig = {
  /** `myteam.cloudflareaccess.com`, with or without `https://`. */
  teamDomain: string;
  /** The Access application's Application Audience (AUD) tag. */
  aud: string;
};

/** The header Cloudflare Access adds to every request it lets through to the origin. */
export const ACCESS_JWT_HEADER = 'cf-access-jwt-assertion';
/** The cookie Access sets in the browser, holding the same token; sent on paths Access does not guard, too. */
export const ACCESS_COOKIE = 'CF_Authorization';
/** Clock difference tolerated on exp, nbf and iat. */
const LEEWAY_S = 60;
/** Certs are read again after this long, and at most this often when a token names an unknown key. */
const CERTS_TTL_MS = 60 * 60_000;
const UNKNOWN_KID_COOLDOWN_MS = 30_000;

export type AccessIdentity = { email: string | null; sub: string | null };

/**
 * Verifies Cloudflare Access tokens (RS256 JWTs) against the team's published
 * certs, with node:crypto only. Keys are cached and read again when a token
 * names a key id not seen yet (Access rotates its keys), at most every 30 s.
 */
export class AccessVerifier {
  readonly issuer: string;
  readonly certsUrl: string;
  private keys = new Map<string, KeyObject>();
  private fetchedAt = 0;
  private pending: Promise<void> | undefined;

  constructor(private readonly config: AccessConfig, private readonly fetchImpl: Fetch = fetch, private readonly now = () => Date.now()) {
    this.issuer = accessIssuer(config.teamDomain);
    this.certsUrl = `${this.issuer}/cdn-cgi/access/certs`;
    if (!config.aud.trim()) throw new Error('The Cloudflare Access audience (AUD) tag is empty.');
  }

  /** The token's identity when it is valid for this application, otherwise undefined. */
  async verify(token: string | undefined): Promise<AccessIdentity | undefined> {
    if (!token) return undefined;
    const parts = token.split('.');
    if (parts.length !== 3) return undefined;
    const [head, body, signature] = parts as [string, string, string];
    let header: { alg?: unknown; kid?: unknown }; let claims: Record<string, unknown>;
    try {
      header = JSON.parse(Buffer.from(head, 'base64url').toString('utf8'));
      claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch { return undefined; }
    if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string' || !claims || typeof claims !== 'object') return undefined;
    const key = await this.key(header.kid);
    if (!key) return undefined;
    if (!verify('RSA-SHA256', Buffer.from(`${head}.${body}`), key, Buffer.from(signature, 'base64url'))) return undefined;

    const now = this.now() / 1000;
    if (claims.iss !== this.issuer) return undefined;
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(this.config.aud)) return undefined;
    if (typeof claims.exp !== 'number' || claims.exp + LEEWAY_S < now) return undefined;
    if (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf - LEEWAY_S > now)) return undefined;
    if (claims.iat !== undefined && (typeof claims.iat !== 'number' || claims.iat - LEEWAY_S > now)) return undefined;
    return { email: typeof claims.email === 'string' ? claims.email : null, sub: typeof claims.sub === 'string' ? claims.sub : null };
  }

  private async key(kid: string) {
    const stale = this.now() - this.fetchedAt > CERTS_TTL_MS;
    const unknown = !this.keys.has(kid) && this.now() - this.fetchedAt > UNKNOWN_KID_COOLDOWN_MS;
    if (stale || unknown) await this.refresh().catch((error) => console.error('[sorting-hat] could not read the Cloudflare Access certs', error));
    return this.keys.get(kid);
  }

  private refresh() {
    this.pending ??= (async () => {
      try {
        const res = await this.fetchImpl(this.certsUrl, { headers: { accept: 'application/json' } });
        if (!res.ok) throw new Error(`${this.certsUrl} answered ${res.status}`);
        const { keys } = await res.json() as { keys?: (JsonWebKeyInput['key'] & { kid?: string })[] };
        const next = new Map<string, KeyObject>();
        for (const jwk of keys ?? []) {
          if (jwk.kty !== 'RSA' || typeof jwk.kid !== 'string') continue;
          try { next.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' })); } catch {}
        }
        this.keys = next;
      } finally {
        // A failed read also waits for the cooldown, so bad tokens cannot make us hammer the endpoint.
        this.fetchedAt = this.now();
        this.pending = undefined;
      }
    })();
    return this.pending;
  }
}

/** `https://<team>.cloudflareaccess.com`: the tokens' issuer, from the team domain as it may be written. */
export function accessIssuer(teamDomain: string) {
  const trimmed = teamDomain.trim().replace(/\/+$/, '');
  const url = new URL(/^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`);
  if (url.pathname !== '/' || url.search || url.hash) throw new Error(`The Cloudflare Access team domain ${teamDomain} should be a host name such as myteam.cloudflareaccess.com.`);
  return url.origin;
}

/** Access settings from SORTING_HAT_ACCESS_TEAM_DOMAIN and SORTING_HAT_ACCESS_AUD; both or neither. */
export function accessFromEnv(env: NodeJS.ProcessEnv): AccessConfig | undefined {
  const teamDomain = env.SORTING_HAT_ACCESS_TEAM_DOMAIN?.trim();
  const aud = env.SORTING_HAT_ACCESS_AUD?.trim();
  if (!teamDomain && !aud) return undefined;
  if (!teamDomain || !aud) throw new Error('Set both SORTING_HAT_ACCESS_TEAM_DOMAIN and SORTING_HAT_ACCESS_AUD to put the dashboard behind Cloudflare Access, or neither.');
  return { teamDomain, aud };
}
