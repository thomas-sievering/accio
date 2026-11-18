import type { LevelContext, ResourceLevel, ResourceScope } from '@accio/protocol';
import { optionalScope } from '@accio/hub';

/** GLOSSARY: Skill level. The scope that turns a CLI or MCP server on at one level of a thread's context. */
export function levelScope(level: ResourceLevel, at: LevelContext): ResourceScope {
  const scope = optionalScope();
  if (level === 'everywhere') return { ...scope, global: true };
  if (level === 'profile') return { ...scope, profileIds: [at.profileId!] };
  if (level === 'space') {
    if (!at.spaceId) throw new Error("This thread's project is in no space. Choose project, profile or everywhere.");
    return { ...scope, spaceIds: [at.spaceId] };
  }
  if (!at.projectKey) throw new Error('This thread has no project. Choose profile or everywhere.');
  return { ...scope, projectKeys: [at.projectKey] };
}

const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];
/** Both scopes' levels: adding a level never takes one away. */
export const mergedScope = (a: ResourceScope, b: ResourceScope): ResourceScope =>
  ({ global: a.global || b.global, profileIds: union(a.profileIds, b.profileIds), spaceIds: union(a.spaceIds, b.spaceIds), projectKeys: union(a.projectKeys, b.projectKeys) });

/** Where a level reaches, in words for a tool result. */
export function levelWhere(level: ResourceLevel, names: { profile?: string; space?: string; project?: string }) {
  return level === 'everywhere' ? 'every thread' : level === 'profile' ? `threads of the ${names.profile ?? 'thread\'s'} profile` : level === 'space' ? `threads in the ${names.space ?? 'thread\'s'} space` : `threads in ${names.project ?? 'this project'}`;
}
