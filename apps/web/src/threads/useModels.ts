import { useEffect, useState } from 'react';
import type { ModelsState } from '@accio/protocol';
import type { AppClient as RpcClient } from '../app/rpcClient';
import { useClient, useConnectionStatus } from '../app/connection';

/** Each profile's model list as last loaded, shared by every picker and mention menu. */
const lastModels = new WeakMap<RpcClient, Map<string, ModelsState>>();
function modelsOf(client: RpcClient) {
  let models = lastModels.get(client);
  if (!models) { models = new Map(); lastModels.set(client, models); }
  return models;
}

/**
 * The profile's models, kept fresh while connected. A remounted user (a draft becoming
 * its thread) shows the last list at once instead of waiting for the call.
 */
export function useModels(profileId: string | undefined, threadId?: string) {
  const client = useClient();
  const ownerThread = client.browser ? threadId : undefined;
  const key = profileId && JSON.stringify([profileId, ownerThread]);
  const status = useConnectionStatus();
  const cache = modelsOf(client);
  const [loaded, setLoaded] = useState<{ client: RpcClient; key: string; state: ModelsState }>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!profileId || !key || status !== 'open') return;
    let active = true;
    let revision = 0;
    const refresh = () => {
      const request = ++revision;
      void client.call('models.list', { profileId, ...(ownerThread ? { threadId: ownerThread } : {}) }).then((state) => {
        if (active && request === revision) modelsOf(client).set(key, state);
        if (active && request === revision) { setLoaded({ client, key, state }); setError(undefined); }
      }, (err: Error) => { if (active && request === revision) setError(err.message); });
    };
    refresh();
    const off = [client.onEvent('models.changed', refresh), client.onEvent('profiles.changed', refresh)];
    return () => { active = false; off.forEach((stop) => stop()); };
  }, [client, status, profileId, ownerThread, key]);

  useEffect(() => setError(undefined), [client, key]);

  const data = loaded && loaded.client === client && loaded.key === key ? loaded.state : key ? cache.get(key) : undefined;
  /** A list a call returned, such as after starring a model. */
  const update = (state: ModelsState) => {
    if (!key) return;
    cache.set(key, state);
    setLoaded({ client, key, state });
  };
  return { data, error, setError, update };
}
