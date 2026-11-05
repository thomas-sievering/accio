import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { measurePrompt, promptCapture } from './promptMeasurement.js';

it('separates instruction sources and counts exposed tools without counting conversation or images', () => {
  const tools = [{ name: 'shell', input_schema: { type: 'object' }, description: 'Run a command' }];
  const measurement = measurePrompt({ model: 'test', system: [{ type: 'text', text: 'Harness instructions' }, { type: 'text', text: 'Accio text\n\nGoal text' }],
    messages: [{ role: 'user', content: 'A very long conversation 🐈' }], tools }, 'Accio text', 'Goal text');
  expect(measurement).toMatchObject({ harness: { characters: 22 }, accio: { characters: 10 }, additional: { characters: 9 },
    tools: { characters: JSON.stringify(tools).length }, toolCount: 1, model: 'test' });
  const codex = measurePrompt({ instructions: 'Harness instructions', input: [
    { role: 'developer', content: [{ type: 'input_text', text: 'Accio text\n\nGoal text' }] },
    { role: 'user', content: [{ type: 'input_text', text: 'Excluded conversation' }] },
  ], tools }, 'Accio text', 'Goal text');
  expect({ ...codex, at: '', model: 'test' }).toEqual({ ...measurement, at: '' });
});

it('does not invent an Accio contribution when it is absent; counts Unicode characters', () => {
  expect(measurePrompt({ instructions: '🐈' }, 'missing')).toMatchObject({
    harness: { characters: 1, estimatedTokens: 1 }, accio: { characters: 0, estimatedTokens: 0 }, toolCount: 0, tools: { characters: 0 },
  });
});

it('counts harness-wrapped project context while leaving the user message and tool output out', () => {
  const agents = '# AGENTS.md instructions for C:/project\n<INSTRUCTIONS>Project rules</INSTRUCTIONS>';
  const environment = '<environment_context>cwd=C:/project</environment_context>';
  const reminder = '<system-reminder>\n# claudeMd\nContents of C:/project/CLAUDE.md:\nProject rules\n</system-reminder>';
  expect(measurePrompt({ input: [{ role: 'user', content: agents }, { role: 'user', content: environment },
    { role: 'user', content: 'Ordinary prompt with # AGENTS.md mentioned inside' },
    { role: 'tool', content: agents }] }, '')).toMatchObject({ context: { characters: agents.length + environment.length } });
  expect(measurePrompt({ messages: [{ role: 'user', content: [{ type: 'text', text: `${reminder}\nActual user question` },
    { type: 'tool_result', content: agents }] }] }, '')).toMatchObject({ context: { characters: reminder.length } });
});

it('observes compressed requests, leaves their bytes/credentials intact, and ignores token-count requests', async () => {
  const forwarded: { path?: string; body: Buffer; authorization?: string }[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    forwarded.push({ path: req.url, body: Buffer.concat(chunks), authorization: req.headers.authorization });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: test\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const seen: unknown[] = [];
  const capture = await promptCapture(`http://127.0.0.1:${address.port}`, body => seen.push(body));
  try {
    const body = gzipSync(JSON.stringify({ system: 'Actual instructions', tools: [] }));
    const response = await fetch(`${capture.url}/v1/messages?beta=true`, { method: 'POST', headers: { authorization: 'Bearer scoped-key', 'content-encoding': 'gzip' }, body });
    expect(await response.text()).toBe('data: test\n\n');
    expect(forwarded[0]).toEqual({ path: '/v1/messages?beta=true', body, authorization: 'Bearer scoped-key' });
    await fetch(`${capture.url}/v1/messages/count_tokens`, { method: 'POST', body: '{}' });
    expect(seen).toEqual([{ system: 'Actual instructions', tools: [] }]);
  } finally { await capture.close(); await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); }
});

it('fails the downstream stream promptly when the upstream disconnects after headers', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: first\n\n');
    setTimeout(() => res.destroy(), 20);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const capture = await promptCapture(`http://127.0.0.1:${(server.address() as { port: number }).port}`, () => {});
  try {
    const response = await fetch(`${capture.url}/v1/messages`, { method: 'POST', body: '{}', signal: AbortSignal.timeout(2000) });
    await expect(response.text()).rejects.toMatchObject({ name: 'TypeError' });
    expect(response.bodyUsed).toBe(true);
  } finally { await capture.close(); await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); }
});
