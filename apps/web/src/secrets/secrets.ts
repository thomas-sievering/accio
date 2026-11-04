import { useCallback, useEffect, useState } from 'react';
import type { SecretSummary } from '@accio/protocol';
import { useClient } from '../app/connection';

export type SecretStore = { available: boolean; reason?: string };

/**
 * Saved-secret metadata for one profile, refetched whenever the Hub reports a
 * change to that profile's secrets. Values never come back from the server.
 */
export function useSecretList(profileId: string | undefined) {
  const client = useClient();
  const [state, setState] = useState<{ profileId?: string; secrets?: SecretSummary[]; error?: string }>({});
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!profileId) return;
    let active = true;
    let generation = 0;
    const load = () => {
      const current = ++generation;
      if (client.status !== 'open') return;
      client.call('secrets.list', { profileId }).then(
        (secrets) => { if (active && current === generation) setState({ profileId, secrets }); },
        (err: unknown) => {
          if (active && current === generation) setState((s) => ({ ...s, error: err instanceof Error ? err.message : 'Could not load secrets' }));
        },
      );
    };
    const offEvent = client.onEvent('secrets.changed', (e) => { if (e.profileId === profileId) load(); });
    const offStatus = client.onStatus(load);
    load();
    return () => { active = false; offEvent(); offStatus(); };
  }, [client, profileId, attempt]);

  const current = state.profileId === profileId;
  return { secrets: current ? state.secrets : undefined, error: current || !state.secrets ? state.error : undefined, retry };
}

/** Whether the Hub can keep saved secrets right now, with a safe reason when it cannot. */
export function useSecretStore(enabled = true): SecretStore | undefined {
  const client = useClient();
  const [store, setStore] = useState<SecretStore>();
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const load = () => {
      if (client.status !== 'open') return;
      client.call('secrets.status', {}).then(
        (s) => { if (active) setStore(s); },
        () => { if (active) setStore({ available: false, reason: 'Could not reach the Hub to check saved secrets.' }); },
      );
    };
    const offStatus = client.onStatus(load);
    load();
    return () => { active = false; offStatus(); };
  }, [client, enabled]);
  return store;
}

/** "All Personal projects", "accio-site, accio", or "No projects yet". */
export function accessLabel(secret: Pick<SecretSummary, 'profileWide' | 'projectIds'>, profileName: string, projectName: (id: string) => string | undefined): string {
  if (secret.profileWide) return `All ${profileName} projects`;
  const names = secret.projectIds.map((id) => projectName(id) ?? 'Removed project');
  return names.length ? names.join(', ') : 'No project access';
}
