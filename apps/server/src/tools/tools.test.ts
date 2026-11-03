import { createServer, type Server } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { z } from 'zod';
import { AccioTools, accioTool } from './tools.js';

let server: Server | undefined;
afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

async function serve(tools: AccioTools) {
  server = createServer((req, res) => void tools.handle(req, res).then((handled) => { if (!handled) res.writeHead(404).end(); }));
  await new Promise<void>((done) => server!.listen(0, '127.0.0.1', () => done()));
  const { port } = server.address() as { port: number };
  tools.listen(`http://127.0.0.1:${port}`);
}

const calls: { threadId: string; text: string }[] = [];
const echo = accioTool({
  name: 'echo',
  description: 'Says it back',
  input: { text: z.string().min(1) },
  call: ({ text }, { threadId }) => { calls.push({ threadId, text }); return `echo: ${text}`; },
});

async function rpc(access: { url: string; authorization?: string }, method: string, params?: unknown, id: number | null = 1) {
  const response = await fetch(access.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(access.authorization ? { authorization: access.authorization } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', ...(id === null ? {} : { id }), method, ...(params ? { params } : {}) }),
  });
  return { status: response.status, body: response.status === 200 ? await response.json() : undefined };
}

it('serves MCP to a turn that holds a grant, and tells tools which thread called', async () => {
  const tools = new AccioTools([echo]);
  await serve(tools);
  const { access } = tools.grant('thread-1')!;
  expect(access.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);

  const init = await rpc(access, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  expect(init.body.result).toMatchObject({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'accio' } });
  expect((await rpc(access, 'notifications/initialized', undefined, null)).status).toBe(202);

  const list = await rpc(access, 'tools/list');
  expect(list.body.result.tools).toEqual([{ name: 'echo', description: 'Says it back', inputSchema: expect.objectContaining({ type: 'object', required: ['text'] }), _meta: { 'anthropic/alwaysLoad': true } }]);
  expect(list.body.result.tools[0].inputSchema).not.toHaveProperty('$schema');

  const call = await rpc(access, 'tools/call', { name: 'echo', arguments: { text: 'hi' } });
  expect(call.body.result).toEqual({ content: [{ type: 'text', text: 'echo: hi' }] });
  expect(calls.at(-1)).toEqual({ threadId: 'thread-1', text: 'hi' });
});

it('reports invalid arguments to the harness as a tool error', async () => {
  const tools = new AccioTools([echo]);
  await serve(tools);
  const { access } = tools.grant('thread-1')!;
  const call = await rpc(access, 'tools/call', { name: 'echo', arguments: { text: '' } });
  expect(call.body.result).toMatchObject({ isError: true, content: [{ type: 'text', text: expect.stringContaining('text') }] });
  expect((await rpc(access, 'tools/call', { name: 'nope' })).body.error).toMatchObject({ code: -32602 });
  expect((await rpc(access, 'resources/list')).body.error).toMatchObject({ code: -32601 });
});

it('refuses calls without a live grant, so a turn that ended can no longer use the tools', async () => {
  const tools = new AccioTools([echo]);
  await serve(tools);
  const grant = tools.grant('thread-1')!;
  expect((await rpc({ url: grant.access.url }, 'tools/list')).status).toBe(401);
  expect((await rpc({ url: grant.access.url, authorization: 'Bearer guessed' }, 'tools/list')).status).toBe(401);
  grant.revoke();
  expect((await rpc(grant.access, 'tools/list')).status).toBe(401);
});

it('grants nothing before the machine server listens', () => {
  expect(new AccioTools([echo]).grant('thread-1')).toBeUndefined();
});
