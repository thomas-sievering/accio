import type { HubClient } from './client.js';
import { SecretStoreError, type SecretsAccess, type SecretScope } from './secrets.js';

/** Cache metadata only. Values travel directly to the machine's scoped delivery logic. */
export function remoteSecrets(client: HubClient): SecretsAccess {
  const listeners = new Set<Parameters<SecretsAccess['onChanged']>[0]>();
  const pending = new Set<Promise<void>>();
  const records = () => client.snapshot?.secrets ?? [];
  const active = () => client.status === 'connected' ? records() : [];
  let previous = active();
  const unsubscribe = client.onChanged(() => {
    const next = active();
    const changed = new Map([...previous, ...next].map(record => [record.id, record]));
    for (const record of changed.values()) {
      if (JSON.stringify(previous.find(s => s.id === record.id)) === JSON.stringify(next.find(s => s.id === record.id))) continue;
      for (const listener of listeners) {
        const operation = Promise.resolve().then(() => listener(record.id, record.profileId));
        pending.add(operation);
        void operation.catch(() => {}).finally(() => pending.delete(operation));
      }
    }
    previous = next;
  });
  async function call<T>(method: string, params?: unknown): Promise<T> {
    try {
      const result = await client.call<T>(method, params);
      await Promise.all([...pending]);
      return result;
    } catch (error) {
      throw new SecretStoreError(error instanceof Error ? error.message : 'The saved secret is unavailable.');
    }
  }
  const scopeOnly = ({ profileId, projectId, slot }: SecretScope) => ({ profileId, projectId, slot });
  return {
    status: () => call('secrets.status'),
    list: profileId => records().filter(s => s.profileId === profileId).map(s => ({ ...s, projectIds: [...s.projectIds] })),
    inUse: profileId => records().some(s => s.profileId === profileId),
    current: (id, version, scope) => active().some(s => s.id === id && s.version === version && s.profileId === scope.profileId && s.slot === scope.slot &&
      (s.profileWide || scope.projectId !== null && s.projectIds.includes(scope.projectId))),
    save: input => call('secrets.save', input),
    remove: async id => { await call('secrets.delete', { id }); },
    bind: async (id, scope) => { await call('secrets.bind', { id, scope: scopeOnly(scope) }); },
    resolve: scope => call('secrets.resolve', scopeOnly(scope)),
    used: async (id, version, scope) => { await call('secrets.used', { id, version, scope: scopeOnly(scope) }); },
    onChanged: listener => { listeners.add(listener); },
    close: async () => { unsubscribe(); await Promise.allSettled([...pending]); listeners.clear(); },
  };
}
