import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { z } from 'zod';
import { UserError } from '../rpc/router.js';
import { SecretStoreError } from '@accio/hub';
import { SecretToolInput, SECRET_TOOL_DESCRIPTION, SECRET_MCP_SERVER, type SecretToolArgs, type SecretDelivery } from './secrets.js';

/** Minimal stateless MCP endpoint for resumed Codex sessions, which cannot add dynamic tools. */
export async function secretHttpTool(request: (input: SecretToolArgs) => Promise<SecretDelivery>) {
  const token = randomBytes(32).toString('base64url');
  const authorization = Buffer.from(`Bearer ${token}`);
  const server = createServer((req, res) => {
    const given = Buffer.from(req.headers.authorization ?? '');
    if (given.length !== authorization.length || !timingSafeEqual(given, authorization)) { res.writeHead(401).end(); return; }
    if (req.url !== '/mcp' || req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }).end(); return; }
    void (async () => {
      let body = ''; for await (const chunk of req) { body += String(chunk); if (body.length > 32_768) { res.writeHead(413).end(); return; } }
      const message = JSON.parse(body);
      if (message.id === undefined) { res.writeHead(202).end(); return; }
      let result: unknown;
      switch (message.method) {
        case 'initialize': result = { protocolVersion: message.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: SECRET_MCP_SERVER, version: '1.0.0' } }; break;
        case 'ping': result = {}; break;
        case 'tools/list': result = { tools: [{ name: 'request_secret', description: SECRET_TOOL_DESCRIPTION, inputSchema: z.toJSONSchema(SecretToolInput) }] }; break;
        case 'tools/call': {
          const input = SecretToolInput.safeParse(message.params?.arguments);
          if (message.params?.name !== 'request_secret' || !input.success) {
            result = { isError: true, content: [{ type: 'text', text: 'Invalid Accio secret tool request.' }] }; break;
          }
          try { result = { content: [{ type: 'text', text: JSON.stringify(await request(input.data)) }] }; }
          catch (error) { result = { isError: true, content: [{ type: 'text', text: error instanceof UserError || error instanceof SecretStoreError ? error.message : 'Could not supply the secret. Check Accio and retry.' }] }; }
          break;
        }
        default: res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Unsupported method' } })); return;
      }
      if (!res.destroyed) res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
    })().catch(() => { if (!res.destroyed) res.writeHead(400).end(); });
  });
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Could not start the private tool.');
  return { token, url: `http://127.0.0.1:${address.port}/mcp`, close: () => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); }) };
}
