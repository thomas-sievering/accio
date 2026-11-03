import type { AssetUrl } from '@accio/protocol';
import type { RpcClient } from '../app/rpcClient';

type Entry = { value?: AssetUrl; pending?: Promise<AssetUrl> };
const urls = new WeakMap<RpcClient, Map<string, Entry>>();

/** Share grants across Markdown rerenders and repeated embeds; never cache machine credentials. */
export function assetUrl(client: RpcClient, threadId: string, assetId: string, download = false, force = false): Promise<AssetUrl> {
  let cache = urls.get(client);
  if (!cache) { cache = new Map(); urls.set(client, cache); }
  const key = JSON.stringify([threadId, assetId, download]);
  let entry = cache.get(key);
  if (!entry) { entry = {}; cache.set(key, entry); }
  if (entry.pending) return entry.pending;
  if (!force && entry.value && entry.value.expiresAt > Date.now() + 10_000) return Promise.resolve(entry.value);
  const current = entry;
  current.pending = client.call('threads.assetUrl', { threadId, assetId, download }).then((result) => {
    const value = { ...result, url: client.httpUrl(result.url) };
    current.value = value;
    return value;
  }).finally(() => { current.pending = undefined; });
  return current.pending;
}
