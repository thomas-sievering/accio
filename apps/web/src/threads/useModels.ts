import { useEffect, useState } from 'react';
import type { ModelsState } from '@accio/protocol';
import type { RpcClient } from '../app/rpcClient';
import { useClient, useConnectionStatus } from '../app/connection';

/** Each profile's model list as last loaded, shared by every picker and mention menu. */
const lastModels = new WeakMap<RpcClient, Map<string, ModelsState>>();

/**
 * The profile's models, kept fresh while connected. A remounted user (a draft becoming
 * its thread) shows the last list at once instead of waiting for the call.
 */
export function useModels(profileId: string | undefined) {
  const client = useClient();
  const status = useConnectionStatus();
  let cache = lastModels.get(client);
  if (!cache) { cache = new Map(); lastModels.set(client, cache); }
  const [loaded, setLoaded] = useState<{ client: RpcClient; profileId: string; state: ModelsState }>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!profileId || status !== 'open') return;
    let active = true;
    let revision = 0;
    const refresh = () => {
      const request = ++revision;
      void client.call('models.list', { profileId }).then((state) => {
        if (active && request === revision) cache.set(profileId, state);
        if (active && request === revision) { setLoaded({ client, profileId, state }); setError(undefined); }
      }, (err: Error) => { if (active && request === revision) setError(err.message); });
    };
    refresh();
    const off = [client.onEvent('models.changed', refresh), client.onEvent('profiles.changed', refresh)];
    return () => { active = false; off.forEach((stop) => stop()); };
  }, [client, status, profileId]);

  useEffect(() => setError(undefined), [client, profileId]);

  const data = loaded && loaded.client === client && loaded.profileId === profileId ? loaded.state : profileId ? cache.get(profileId) : undefined;
  /** A list a call returned, such as after starring a model. */
  const update = (state: ModelsState) => {
    if (!profileId) return;
    cache.set(profileId, state);
    setLoaded({ client, profileId, state });
  };
  return { data, error, setError, update };
}
