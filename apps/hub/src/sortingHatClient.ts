import type { AccountLimitsView, AccountView, ProviderId } from '@accio/protocol';
import type { CodexModel } from '@accio/sorting-hat';
import { HubError } from './errors.js';

/** The Sorting Hat's house (apps/sorting-hat/API.md). */
export type RemoteHouse = {
  id: string; name: string;
  accounts: Record<ProviderId, string[]>;
  inUse: Record<ProviderId, string | null>;
};
export type RemoteHatKey = { id: string; houseId: string; name: string; createdAt: string; revokedAt: string | null };

export type SignInStatus = { status: 'pending' } | { status: 'complete'; account: AccountView };

type Fetch = typeof fetch;

/** A refusal from the Sorting Hat, safe to show: its own message, or the hub's words for what went wrong in between. */
export class SortingHatError extends HubError {
  constructor(message: string, readonly status: number) { super(message); }
}

/**
 * GLOSSARY: Sorting Hat. A typed client for its management API, authorized by
 * the admin token. The token goes only into the Authorization header here; it
 * never appears in an error message.
 */
export class SortingHatClient {
  constructor(readonly url: string, private token: string, private fetchImpl: Fetch = fetch) {}

  accounts() { return this.request<AccountView[]>('GET', 'accounts'); }
  createAccount(name: string, providerId: ProviderId) { return this.request<AccountView>('POST', 'accounts', { name, providerId }); }
  renameAccount(id: string, name: string) { return this.request<AccountView>('PATCH', `accounts/${encodeURIComponent(id)}`, { name }); }
  async deleteAccount(id: string) { await this.request<void>('DELETE', `accounts/${encodeURIComponent(id)}`); }
  signOut(id: string) { return this.request<AccountView>('POST', `accounts/${encodeURIComponent(id)}/sign-out`); }
  /** Claude takes the worker's browser callback; ChatGPT uses its browser flow, the default. */
  beginSignIn(id: string, redirectUri?: string) {
    return this.request<{ providerId: ProviderId; signInId: string; url: string; userCode?: string }>('POST', `accounts/${encodeURIComponent(id)}/sign-in`, redirectUri ? { redirectUri } : {});
  }
  signInStatus(id: string) { return this.request<SignInStatus>('GET', `sign-ins/${encodeURIComponent(id)}`); }
  completeSignIn(id: string, body: { code: string; state?: string }) { return this.request<SignInStatus>('POST', `sign-ins/${encodeURIComponent(id)}/complete`, body); }
  async cancelSignIn(id: string) { await this.request<void>('DELETE', `sign-ins/${encodeURIComponent(id)}`); }
  createHouse(name: string) { return this.request<RemoteHouse>('POST', 'houses', { name }); }
  houses() { return this.request<RemoteHouse[]>('GET', 'houses'); }
  house(id: string) { return this.request<RemoteHouse>('GET', `houses/${encodeURIComponent(id)}`); }
  setHouseAccounts(id: string, selection: Partial<Record<ProviderId, string[]>>) {
    return this.request<RemoteHouse>('PUT', `houses/${encodeURIComponent(id)}/accounts`, selection);
  }
  houseModels(id: string) { return this.request<{ openai: CodexModel[] }>('GET', `houses/${encodeURIComponent(id)}/models`); }
  hatKey(id: string) { return this.request<RemoteHatKey>('GET', `hat-keys/${encodeURIComponent(id)}`); }
  createHatKey(houseId: string, name: string) { return this.request<RemoteHatKey & { secret: string }>('POST', 'hat-keys', { houseId, name }); }
  renameHatKey(id: string, name: string) { return this.request<RemoteHatKey>('PATCH', `hat-keys/${encodeURIComponent(id)}`, { name }); }
  async deleteHatKey(id: string) { await this.request<void>('DELETE', `hat-keys/${encodeURIComponent(id)}`); }
  limits() { return this.request<AccountLimitsView[]>('GET', 'limits'); }
  refreshLimits(accountIds?: string[], force = false) { return this.request<AccountLimitsView[]>('POST', 'limits/refresh', { ...(accountIds ? { accountIds } : {}), force }); }

  private async request<T>(method: string, path: string, body?: unknown, timeoutMs = 15_000): Promise<T> {
    const host = new URL(this.url).host;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.url}/api/${path}`, {
        method, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
        headers: { authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new SortingHatError(`Could not reach the Sorting Hat at ${host}. Check its address and that it is running.`, 0);
    }
    if (response.status === 204) return undefined as T;
    let data: any;
    try { data = await response.json(); } catch { data = undefined; }
    const message = typeof data?.error?.message === 'string' ? data.error.message.slice(0, 500) : undefined;
    if (response.ok && data !== undefined) return data as T;
    if (response.status === 401 && message) throw new SortingHatError('The Sorting Hat refused the admin token. Paste a current one from its dashboard in Settings / Hubs.', 401);
    // A login page or proxy answers without the Sorting Hat's error body, such as Cloudflare Access redirecting to sign in.
    if (!message) throw new SortingHatError(`${host} answered as something other than the Sorting Hat (HTTP ${response.status}). Check the address, and that the hub may reach its /api/ paths.`, response.status);
    if (response.status >= 500) throw new SortingHatError(`The Sorting Hat could not do that (HTTP ${response.status}). Try again.`, response.status);
    throw new SortingHatError(message, response.status);
  }
}

/**
 * A Sorting Hat address: HTTPS, or HTTP on loopback or a single-label host
 * (a service name inside the hub's own network), since the admin token goes with every request.
 */
export function sortingHatAddress(text: string): string {
  let url: URL;
  try { url = new URL(text.trim()); } catch { throw new HubError('Enter the Sorting Hat’s address, such as https://sortinghat.example.com'); }
  const host = url.hostname;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(host) || !host.includes('.') && !host.includes(':') && !host.startsWith('[');
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))) throw new HubError('Use an HTTPS address for the Sorting Hat, or HTTP on localhost or the hub’s own network.');
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}
