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

it('allows a measurement grant to list standard tools but forbids execution and contextual tools', async () => {
  const tools = new AccioTools([echo, { ...echo, name: 'contextual', available: () => { throw new Error('No thread exists for a baseline'); } }]);
  await serve(tools);
  const grant = tools.measurementGrant()!;
  expect((await rpc(grant.access, 'tools/list')).body.result.tools.map((tool: { name: string }) => tool.name)).toEqual(['echo']);
  expect((await rpc(grant.access, 'tools/call', { name: 'echo', arguments: { text: 'never executed' } })).body.error.code).toBe(-32601);
  grant.revoke();
  expect((await rpc(grant.access, 'tools/list')).status).toBe(401);
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

it('grants nothing before the worker listens', () => {
  expect(new AccioTools([echo]).grant('thread-1')).toBeUndefined();
});

const working = accioTool({
  name: 'work',
  description: 'Reports progress while it works',
  input: {},
  call: (_args, { progress }) => { progress('Bash: ls'); progress('Read: a.txt'); return 'done'; },
});

async function callWork(access: { url: string; authorization: string }, accept: string, meta?: unknown) {
  const response = await fetch(access.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept, authorization: access.authorization },
    body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'work', arguments: {}, ...(meta ? { _meta: meta } : {}) } }),
  });
  return { type: response.headers.get('content-type') ?? '', text: await response.text() };
}

it('streams progress to a caller that asked for it, so a long call is not taken for a hung one', async () => {
  const tools = new AccioTools([working]);
  await serve(tools);
  const { access } = tools.grant('thread-1')!;
  const streamed = await callWork(access, 'application/json, text/event-stream', { progressToken: 'p-1' });
  expect(streamed.type).toMatch(/^text\/event-stream/);
  const events = streamed.text.split('\n\n').filter(Boolean).map((e) => JSON.parse(e.split('\n').find((l) => l.startsWith('data: '))!.slice(6)));
  expect(events).toEqual([
    { jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: 'p-1', progress: 1, message: 'Bash: ls' } },
    { jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: 'p-1', progress: 2, message: 'Read: a.txt' } },
    { jsonrpc: '2.0', id: 7, result: { content: [{ type: 'text', text: 'done' }] } },
  ]);

  // Without a token, or without accepting event streams, the answer stays plain JSON.
  for (const [accept, meta] of [['application/json, text/event-stream', undefined], ['application/json', { progressToken: 'p-2' }]] as const) {
    const plain = await callWork(access, accept, meta);
    expect(plain.type).toMatch(/^application\/json/);
    expect(JSON.parse(plain.text)).toEqual({ jsonrpc: '2.0', id: 7, result: { content: [{ type: 'text', text: 'done' }] } });
  }
});
