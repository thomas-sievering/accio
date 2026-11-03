import { readFile } from 'node:fs/promises';
import { afterEach, expect, it } from 'vitest';
import { startTestApp, fakeClaudeFetch } from '../testing/testApp.js';
import { claudeCode } from '../threads/claudeCode.js';

let app: Awaited<ReturnType<typeof startTestApp>>;
afterEach(() => app?.stop());

it('runs the real Claude CLI and SDK MCP handoff against a local scripted provider', async () => {
  const marker = 'DUMMY_NATIVE_CLAUDE_TOKEN'; const bodies: any[] = []; let deliveredFile = '';
  app = await startTestApp({ harness: { run(run) { return claudeCode.run({ ...run, env: { ...run.env,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
  } }); } }, claudeFetch: async (url, init) => {
    if (String(url).includes('/oauth/token')) return fakeClaudeFetch(url, init);
    if (String(url).includes('count_tokens')) return Response.json({ input_tokens: 10 });
    if (!String(url).includes('/v1/messages')) return Response.json({});
    const body = JSON.parse(new TextDecoder().decode(init?.body as Uint8Array)); bodies.push(body);
    const n = bodies.length;
    const useTool = n === 1;
    if (n === 2) {
      const result = body.messages.flatMap((m: any) => Array.isArray(m.content) ? m.content : []).find((c: any) => c.type === 'tool_result' && c.tool_use_id === 'secret_tool_1');
      expect(result).toBeDefined();
      const text = typeof result.content === 'string' ? result.content : result.content.find((c: any) => c.type === 'text')?.text;
      const delivery = JSON.parse(text); expect(delivery.status).toBe('provided'); deliveredFile = delivery.file;
      expect(await readFile(deliveredFile, 'utf8')).toBe(marker);
    }
    const events = [
      { type: 'message_start', message: { id: `msg_${n}`, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: useTool ? { type: 'tool_use', id: 'secret_tool_1', name: 'mcp__accio__request_secret', input: {} } : { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: useTool ? { type: 'input_json_delta', partial_json: JSON.stringify({ slot: 'claude.native:test', label: 'Claude token', reason: 'Verify private SDK delivery' }) } : { type: 'text_delta', text: 'Private Claude delivery complete.' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: useTool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } },
      { type: 'message_stop' },
    ];
    return new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
  } });
  const client = await app.connect(); const profile = await client.signedIn('Native Claude');
  const thread = await client.call('threads.start', { profileId: profile.id, text: 'Use the private secret tool.' });
  const event = await client.waitFor('thread.item', e => e.threadId === thread.id && e.item.kind === 'secret' && e.item.status === 'pending', 25_000);
  if (event.item.kind !== 'secret') throw new Error('Missing native Claude secret request');
  await client.call('secretRequests.answer', { threadId: thread.id, requestId: event.item.requestId, answer: { type: 'once', value: marker } });
  await expect.poll(async () => (await client.call('threads.list', {})).find(t => t.id === thread.id)?.status, { timeout: 15_000 }).toBe('idle');
  expect(bodies[0].tools.some((t: any) => t.name === 'mcp__accio__request_secret')).toBe(true);
  expect(bodies).toHaveLength(2); expect(JSON.stringify(bodies)).not.toContain(marker);
  await expect(readFile(deliveredFile)).rejects.toThrow();
}, 45_000);
