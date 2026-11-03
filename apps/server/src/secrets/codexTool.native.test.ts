import { readFile } from 'node:fs/promises';
import { afterEach, expect, it } from 'vitest';
import { FakeCodex } from '../testing/fakeCodex.js';
import { startTestApp } from '../testing/testApp.js';
import { codexHarness } from '../threads/codex.js';

let app: Awaited<ReturnType<typeof startTestApp>>;
afterEach(() => app?.stop());

it('executes request_secret through the pinned native Codex dynamic-tool protocol', async () => {
  const login = new FakeCodex(); const bodies: any[] = [];
  const marker = 'DUMMY_NATIVE_SECRET_MARKER'; let deliveryPath = '';
  app = await startTestApp({ codexFactory: login.factory, codexHarness: codexHarness(), openaiFetch: async (_url, init) => {
    const body = JSON.parse(new TextDecoder().decode(init?.body as Uint8Array)); bodies.push(body);
    const n = bodies.length;
    const output = n === 1 ? { id: 'fc_secret_1', type: 'function_call', call_id: 'call_secret_1', name: 'request_secret',
      arguments: JSON.stringify({ slot: 'native.secret:test', label: 'Native test token', reason: 'Verify the native private tool', clientRequestId: 'native-test' }), status: 'completed' }
      : { id: 'msg_done', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Private delivery complete.', annotations: [] }] };
    if (n === 2) {
      const item = body.input.find((i: any) => i.type === 'function_call_output' && i.call_id === 'call_secret_1');
      expect(item).toBeDefined();
      const result = JSON.parse(typeof item.output === 'string' ? item.output : item.output.find((c: any) => c.type === 'input_text')?.text);
      expect(result.status).toBe('provided'); deliveryPath = result.file;
      expect(await readFile(deliveryPath, 'utf8')).toBe(marker);
    }
    const response = { id: `resp_${n}`, object: 'response', created_at: 1, status: 'completed', model: 'test-codex', output: [output], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } };
    const events = [
      { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item: { ...output, status: 'in_progress' } },
      { type: 'response.output_item.done', output_index: 0, item: output },
      { type: 'response.completed', response },
    ];
    return new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
  } });
  const client = await app.connect();
  const account = await client.call('accounts.save', { name: 'Native secret', providerId: 'openai' });
  const signIn = await client.call('accounts.beginSignIn', { id: account.id }); await login.latest.complete('native-secret');
  await client.call('accounts.signInStatus', { signInId: signIn.signInId });
  const profile = await client.call('profiles.save', { name: 'Native secret', openaiAccountId: account.id });
  const thread = await client.call('threads.start', { profileId: profile.id, text: 'Use the private token tool.' });
  const card = await client.waitFor('thread.item', e => e.threadId === thread.id && e.item.kind === 'secret' && e.item.status === 'pending', 15_000);
  if (card.item.kind !== 'secret') throw new Error('Missing secret card');
  await client.call('secretRequests.answer', { threadId: thread.id, requestId: card.item.requestId, answer: { type: 'once', value: marker } });
  await expect.poll(async () => (await client.call('threads.list', {})).find(t => t.id === thread.id)?.status, { timeout: 15_000 }).toBe('idle');
  expect(bodies[0].tools.some((t: any) => t.name === 'request_secret')).toBe(true);
  expect(bodies[0].tools.some((t: any) => t.name === 'mcp__accio')).toBe(true);
  expect(JSON.stringify(bodies)).not.toContain(marker);
  expect(deliveryPath).not.toBe(''); await expect(readFile(deliveryPath)).rejects.toThrow();
}, 35_000);

it('adds the private MCP tool when resuming a native Codex thread created before secrets existed', async () => {
  const login = new FakeCodex(); const bodies: any[] = []; const native = codexHarness(); let turns = 0;
  app = await startTestApp({ codexFactory: login.factory, codexHarness: { run(run) {
    return native.run({ ...run, requestSecret: ++turns === 1 ? undefined : run.requestSecret });
  } }, openaiFetch: async (_url, init) => {
    const body = JSON.parse(new TextDecoder().decode(init?.body as Uint8Array)); bodies.push(body);
    const n = bodies.length;
    let output: any = { id: `msg_${n}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Native turn complete.', annotations: [] }] };
    if (n === 2) {
      const tool = body.tools.find((t: any) => t.name === 'mcp__accio_secrets');
      expect(tool?.tools.some((t: any) => t.name === 'request_secret')).toBe(true);
      expect(body.tools.some((t: any) => t.name === 'mcp__accio')).toBe(true);
      output = { id: 'fc_mcp', type: 'function_call', call_id: 'call_mcp', namespace: 'mcp__accio_secrets', name: 'request_secret', status: 'completed',
        arguments: JSON.stringify({ slot: 'native.secret:resumed', label: 'Resumed token', reason: 'Verify the old session tool' }) };
    }
    if (n === 3) expect(JSON.stringify(body.input.filter((i: any) => i.type === 'function_call_output'))).toContain('provided');
    const response = { id: `resp_${n}`, object: 'response', created_at: 1, status: 'completed', model: 'test-codex', output: [output], usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 } };
    const events = [{ type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item: output }, { type: 'response.output_item.done', output_index: 0, item: output }, { type: 'response.completed', response }];
    return new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
  } });
  const client = await app.connect(); const account = await client.call('accounts.save', { name: 'Old native', providerId: 'openai' });
  const signIn = await client.call('accounts.beginSignIn', { id: account.id }); await login.latest.complete('old-native');
  await client.call('accounts.signInStatus', { signInId: signIn.signInId });
  const profile = await client.call('profiles.save', { name: 'Old native', openaiAccountId: account.id });
  const thread = await client.call('threads.start', { profileId: profile.id, text: 'Create a pre-secret session.' });
  await expect.poll(async () => (await client.call('threads.list', {})).find(t => t.id === thread.id)?.status, { timeout: 15000 }).toBe('idle');
  client.events.length = 0;
  await client.call('threads.send', { threadId: thread.id, text: 'Use the new private token tool.' });
  const event = await client.waitFor('thread.item', e => e.threadId === thread.id && e.item.kind === 'secret' && e.item.status === 'pending', 15_000);
  if (event.item.kind !== 'secret') throw new Error('Missing resumed secret card');
  await client.call('secretRequests.answer', { threadId: thread.id, requestId: event.item.requestId, answer: { type: 'once', value: 'DUMMY_RESUMED_TOKEN' } });
  await expect.poll(async () => (await client.call('threads.list', {})).find(t => t.id === thread.id)?.status, { timeout: 15_000 }).toBe('idle');
  expect(bodies).toHaveLength(3); expect(JSON.stringify(bodies)).not.toContain('DUMMY_RESUMED_TOKEN');
}, 35_000);
