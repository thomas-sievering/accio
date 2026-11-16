import { describe, expect, it } from 'vitest';
import type { HubClient } from './client.js';
import { remoteResources } from './resourceClient.js';

describe('remoteResources', () => {
  it('fills in space ids for a hub from before spaces had skills', () => {
    const skill = { id: 'library:review', sourceId: 'library', name: 'review', description: '', path: '/p', revision: 'abc', scope: { global: false, profileIds: ['personal'], projectKeys: [] } };
    const client = { snapshot: { resources: { tools: [], sources: [], skills: [skill], mcps: [], toolStatuses: [], skillVersions: [] } } } as unknown as HubClient;
    expect(remoteResources(client).state().skills[0]!.scope).toEqual({ global: false, profileIds: ['personal'], projectKeys: [], spaceIds: [] });
  });
});
