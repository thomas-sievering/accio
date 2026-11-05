import type { RpcClient } from '../app/rpcClient';

type FirstMessage = { text?: string; images: string[]; timer: ReturnType<typeof setTimeout> };
const previews = new WeakMap<RpcClient, Map<string, FirstMessage>>();

/** Temporary first-message paint, scoped to its connection and bounded if never opened. */
export function keepFirstMessage(client: RpcClient, threadId: string, text: string, images: string[]) {
  let cache = previews.get(client);
  if (!cache) { cache = new Map(); previews.set(client, cache); }
  const entry: FirstMessage = { text, images: [...images], timer: setTimeout(() => releaseFirstMessage(client, threadId), 5 * 60_000) };
  cache.set(threadId, entry);
}

export function firstMessage(client: RpcClient, threadId: string) {
  const entry = previews.get(client)?.get(threadId);
  return entry?.text === undefined ? undefined : { text: entry.text, images: entry.images };
}

/** The durable transcript has taken over; decoded images release their copies separately. */
export function forgetFirstMessage(client: RpcClient, threadId: string) {
  const entry = previews.get(client)?.get(threadId);
  if (!entry) return;
  entry.text = undefined;
  if (entry.images.every(url => !url)) releaseFirstMessage(client, threadId);
}

export function sentImage(client: RpcClient, threadId: string, index: number): string | undefined {
  return previews.get(client)?.get(threadId)?.images[index];
}

export function releaseSentImage(client: RpcClient, threadId: string, index: number) {
  const entry = previews.get(client)?.get(threadId);
  const url = entry?.images[index];
  if (!entry || !url) return;
  URL.revokeObjectURL(url);
  entry.images[index] = '';
  if (entry.text === undefined && entry.images.every(url => !url)) releaseFirstMessage(client, threadId);
}

export function releaseFirstMessage(client: RpcClient, threadId: string) {
  const entry = previews.get(client)?.get(threadId);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.images.forEach(url => { if (url) URL.revokeObjectURL(url); });
  previews.get(client)?.delete(threadId);
}

export function clearFirstMessages(client: RpcClient) {
  for (const id of previews.get(client)?.keys() ?? []) releaseFirstMessage(client, id);
}
