// A standalone Sorting Hat for hub and worker tests, with every provider faked
// by the Sorting Hat's own test fakes. No developer account is ever used.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startStandalone } from '@accio/sorting-hat';
import { FakeCodex, fakeAnthropicApi, fakeAnthropicAuth, fakeChatGPT } from '../../../sorting-hat/src/testing/fakeProviders.js';

export async function startRemoteSortingHat() {
  const dir = await mkdtemp(join(tmpdir(), 'accio-remote-hat-'));
  const auth = fakeAnthropicAuth();
  const anthropic = await fakeAnthropicApi();
  const chatgpt = fakeChatGPT();
  const codex = new FakeCodex();
  const hat = await startStandalone({ dir, claudeFetch: auth.fetch, anthropicUrl: anthropic.url, codexFactory: codex.factory, openaiFetch: chatgpt.fetch, openaiUrl: 'https://chatgpt.test/backend-api/codex' });
  /** A management call as the dashboard makes it; throws unless it succeeds. */
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${hat.url}/api/${path}`, { method, headers: { authorization: `Bearer ${hat.adminToken}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    if (res.status >= 300) throw new Error(`${method} ${path}: ${res.status} ${text}`);
    return text ? JSON.parse(text) : undefined;
  };
  /** A Claude account signed in with the paste-code flow; its first token is `token-<n>`. */
  const claudeAccount = async (name: string) => {
    const account = await api('POST', 'accounts', { name, providerId: 'anthropic' });
    const signIn = await api('POST', `accounts/${account.id}/sign-in`);
    await api('POST', `sign-ins/${signIn.signInId}/complete`, { code: `pasted#${new URL(signIn.url).searchParams.get('state')}` });
    return account as { id: string };
  };
  /** A ChatGPT account signed in with the device flow, as `who` (its chatgpt-account-id). */
  const chatgptAccount = async (name: string, who: string) => {
    const account = await api('POST', 'accounts', { name, providerId: 'openai' });
    const signIn = await api('POST', `accounts/${account.id}/sign-in`, { flow: 'device' });
    await codex.latest.complete(who);
    await api('GET', `sign-ins/${signIn.signInId}`);
    return account as { id: string };
  };
  return {
    url: hat.url, adminToken: hat.adminToken, anthropic, chatgpt, api, claudeAccount, chatgptAccount,
    close: async () => { await hat.close(); await anthropic.close(); await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); },
  };
}
