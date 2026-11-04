import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { secretMcpServer } from './claudeTool.js';

it('exposes and executes the real Claude SDK MCP tool without a value in its result', async () => {
  const sdkRequire = createRequire(import.meta.resolve('@anthropic-ai/claude-agent-sdk'));
  const { Client } = await import(pathToFileURL(sdkRequire.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
  const { InMemoryTransport } = await import(pathToFileURL(sdkRequire.resolve('@modelcontextprotocol/sdk/inMemory.js')).href);
  const args: unknown[] = [];
  const config = secretMcpServer(async input => {
    args.push(input); return { status: 'provided', file: 'C:/private-delivery/dummy', expiresAt: '2026-11-04T00:00:00.000Z' };
  });
  const client = new Client({ name: 'accio-secret-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(clientTransport), config.instance.connect(serverTransport)]);
    const list = await client.listTools();
    expect(list.tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'request_secret' })]));
    const result = await client.callTool({ name: 'request_secret', arguments: { slot: 'cloudflare.pages.deploy:docs', label: 'Deployment token', reason: 'Deploy docs' } });
    expect(args).toHaveLength(1);
    expect(JSON.stringify(result)).toContain('C:/private-delivery/dummy');
    expect(JSON.stringify(result)).not.toContain('value');
  } finally { await client.close(); await config.instance.close(); }
});
