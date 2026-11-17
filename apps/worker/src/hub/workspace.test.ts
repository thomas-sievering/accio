import { describe, expect, it } from 'vitest';
import type { HubSnapshot } from '@accio/hub';
import { cachedSnapshot } from './workspace.js';

const account = { id: 'a', name: 'Mine', providerId: 'anthropic', signedIn: true, email: null, organization: null };
const provider = { id: 'anthropic', name: 'Anthropic', accountName: 'Claude account', available: true, inUseId: 'a' };
const snapshot = (providers: object[]) => ({ hubId: 'hub', profiles: [{ id: 'p', name: 'P', house: null, providers }], accounts: [account] }) as unknown as HubSnapshot;

describe('a hub connection’s cached snapshot', () => {
  it('is used while profiles name their accounts by id', () => {
    const current = snapshot([{ ...provider, accountIds: ['a'] }]);
    expect(cachedSnapshot(current)).toBe(current);
  });

  it('is dropped when an older build embedded the accounts, or it can’t be read', () => {
    expect(cachedSnapshot(snapshot([{ ...provider, accounts: [account] }]))).toBeUndefined();
    expect(cachedSnapshot({ hubId: 'hub' } as unknown as HubSnapshot)).toBeUndefined();
    expect(cachedSnapshot(undefined)).toBeUndefined();
  });
});
