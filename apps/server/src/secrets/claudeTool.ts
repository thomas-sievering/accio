import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { SecretStoreError } from '@accio/hub';
import { UserError } from '../rpc/router.js';
import { SecretToolInput, SECRET_TOOL_DESCRIPTION, SECRET_MCP_SERVER, type SecretToolArgs, type SecretDelivery } from './secrets.js';

export function secretMcpServer(request: (input: SecretToolArgs) => Promise<SecretDelivery>) {
  return createSdkMcpServer({ name: SECRET_MCP_SERVER, version: '1.0.0', tools: [
    tool('request_secret', SECRET_TOOL_DESCRIPTION, SecretToolInput.shape, async input => {
      try { return { content: [{ type: 'text' as const, text: JSON.stringify(await request(input)) }] }; }
      catch (error) { return { isError: true, content: [{ type: 'text' as const,
        text: error instanceof UserError || error instanceof SecretStoreError ? error.message : 'Could not obtain the secret. Retry through request_secret.' }] }; }
    }, { alwaysLoad: true }),
  ] });
}
