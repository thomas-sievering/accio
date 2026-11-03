import type { McpDefinition, McpView } from '@accio/protocol';

/** The saved definition of a server, without the hub's view-only fields. */
export function mcpDefinition(m: McpView): McpDefinition {
  return { id: m.id, name: m.name, transport: m.transport, url: m.url, command: m.command, args: m.args, scope: m.scope, auth: m.auth, oauthClientId: m.oauthClientId };
}
