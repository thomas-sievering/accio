import { ResourceScope, type ResourcesState } from '@accio/protocol';
import type { HubClient } from './client.js';
import type { ResourceAccess } from './resources.js';
import type { McpAccess } from './mcp.js';

export const RESOURCE_WRITES = ['saveTool', 'deleteTool', 'saveSource', 'stageSkills', 'applySkills', 'deleteSource', 'setSkillScope', 'setSkillProject', 'setSkillSpace', 'saveMcp', 'deleteMcp', 'setCredential', 'setToolStatus'] as const;

/** Definitions are shared; installing tools and materializing skills stays on the machine. */
export function remoteResources(client: HubClient): ResourceAccess {
  return {
    state: () => withScopes(client.snapshot?.resources ?? { tools: [], sources: [], skills: [], mcps: [], toolStatuses: [], skillVersions: [] }),
    ...Object.fromEntries(RESOURCE_WRITES.map(method => [method, (...args: unknown[]) => client.call('resources.write', { method, args })])),
  } as ResourceAccess;
}

/** A hub from before spaces had skills sends scopes without space ids. */
function withScopes(state: ResourcesState): ResourcesState {
  return state.skills.every(skill => Array.isArray(skill.scope.spaceIds)) ? state : { ...state, skills: state.skills.map(skill => ({ ...skill, scope: ResourceScope.parse(skill.scope) })) };
}

/** Only short-lived MCP grants reach a harness; upstream credentials remain at its hub. */
export function remoteMcp(client: HubClient): McpAccess {
  return {
    beginSignIn: id => client.call('mcp.beginSignIn', { id }),
    completeSignIn: (callbackUrl, id) => client.call('mcp.completeSignIn', { id, callbackUrl }),
    signOut: id => client.call('mcp.signOut', { id }),
    grant: async (id, profileId, projectKey) => {
      const grant = await client.call('mcp.grant', { id, profileId, projectKey });
      return { url: `${client.url}/mcp/access/${encodeURIComponent(id)}`, token: grant.token,
        release: () => { void client.call('mcp.release', { token: grant.token }).catch(() => {}); } };
    },
  };
}
