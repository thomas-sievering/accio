import { OpenAIAuth } from './openaiAuth.js';
import { startForwarding } from './proxy.js';
import { SortingHat } from './sortingHat.js';
import type { CodexFactory } from './codex.js';
import type { Fetch } from './types.js';

export { SignInError, SIGN_IN_TTL_MS } from './claudeOAuth.js';
export type { CodexModel } from './openaiAuth.js';
export type { CodexClient, CodexFactory, CodexNotification } from './codex.js';
export type { AccountSelection } from './sortingHat.js';
export type { AccountLimitsView, AccountView, Fetch, LimitWindow, LimitsProblem, LimitsSnapshot, ProviderId } from './types.js';

/**
 * What an app embedding the Sorting Hat in-process may call (ADR 0018). Today
 * that app is Accio's hub, which links each profile to the house of the same id.
 * Forwarding is reached over HTTP at `url` with a house's key, never through here.
 */
export type SortingHatApi = Pick<SortingHat,
  // Accounts
  | 'accountViews' | 'accountView' | 'saveAccount' | 'deleteAccount' | 'signOutAccount'
  // Sign-in: Claude pastes or calls back a code; ChatGPT completes in Codex and is polled.
  | 'beginAccountSignIn' | 'completeAccountSignIn' | 'beginOpenAISignIn' | 'completeOpenAICallback' | 'openaiSignInStatus' | 'cancelAccountSignIn'
  // Houses: their keys, ordered accounts and the account in use.
  | 'ensureHouse' | 'configureHouse' | 'removeHouse' | 'selectedAccounts' | 'accountIdInUse'
  // Limits and models
  | 'limitViews' | 'onLimitsChanged' | 'refreshLimits' | 'codexModels' | 'refreshCodexModels'
> & {
  /** Where model requests go, with a house's key as bearer token or x-api-key. */
  readonly url: string;
  close(): Promise<void>;
};

export type SortingHatOptions = {
  /** The Sorting Hat's state directory: account storage and ChatGPT credential homes. */
  dir: string;
  /** Used for Claude sign-in, refresh, limits and forwarding. */
  claudeFetch?: Fetch;
  codexFactory?: CodexFactory;
  anthropicUrl?: string;
  openaiUrl?: string;
  openaiFetch?: Fetch;
};

/** Loads the accounts and starts forwarding on a loopback port. */
export async function startSortingHat(opts: SortingHatOptions): Promise<SortingHatApi> {
  const hat = new SortingHat(opts.dir, opts.claudeFetch, new OpenAIAuth(opts.dir, opts.codexFactory));
  await hat.load();
  let forwarding;
  try {
    forwarding = await startForwarding({ accounts: hat, host: '127.0.0.1', port: 0, upstream: opts.anthropicUrl, fetchImpl: opts.claudeFetch, openaiUpstream: opts.openaiUrl, openaiFetch: opts.openaiFetch });
  } catch (error) { await hat.close(); throw error; }
  const close = hat.close.bind(hat);
  // The instance itself, so callers that spy on a method see the calls made through it.
  return Object.assign(hat, { url: forwarding.url, close: async () => { await forwarding.close(); await close(); } });
}
