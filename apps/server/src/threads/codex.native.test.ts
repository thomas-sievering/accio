import { afterEach, expect, it } from 'vitest';
import { FakeCodex } from '../testing/fakeCodex.js';
import { startTestApp } from '../testing/testApp.js';
import { codexHarness } from './codex.js';

let app: Awaited<ReturnType<typeof startTestApp>>;
afterEach(() => app?.stop());

/** Exercises the pinned native binary and its actual wire protocol; inference stays local and scripted. */
it('runs the bundled Codex through the hub proxy and restores its native session', async () => {
  const login = new FakeCodex();
  const requests: { headers: Headers; body: any }[] = [];
  app = await startTestApp({ codexFactory: login.factory, codexHarness: codexHarness(), openaiFetch: async (_url, init) => {
    requests.push({ headers: new Headers(init?.headers), body: JSON.parse(new TextDecoder().decode(init?.body as Uint8Array)) });
    const id = `resp_${requests.length}`;
    const message = { id: `msg_${requests.length}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Native Codex reply.', annotations: [] }] };
    const response = { id, object: 'response', created_at: 1, status: 'completed', model: 'test-codex', output: [message], usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 } };
    const events = [
      { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item: { ...message, status: 'in_progress', content: [] } },
      { type: 'response.content_part.added', item_id: message.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
      { type: 'response.output_text.delta', item_id: message.id, output_index: 0, content_index: 0, delta: 'Native Codex reply.' },
      { type: 'response.output_text.done', item_id: message.id, output_index: 0, content_index: 0, text: 'Native Codex reply.' },
      { type: 'response.output_item.done', output_index: 0, item: message },
      { type: 'response.completed', response },
    ];
    return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
  } });
  const client = await app.connect();
  const account = await client.call('accounts.save', { name: 'Native test', providerId: 'openai' });
  const signIn = await client.call('accounts.beginSignIn', { id: account.id });
  await login.latest.complete('native');
  await client.call('accounts.signInStatus', { signInId: signIn.signInId });
  const profile = await client.call('profiles.save', { name: 'Native test', openaiAccountId: account.id });
  const thread = await client.call('threads.start', { profileId: profile.id, text: 'Say hello.' });
  await client.waitFor('threads.changed', (threads) => threads.some((t) => t.id === thread.id && t.status !== 'running'), 15_000);
  const first = (await client.call('threads.list', {})).find((t) => t.id === thread.id);
  const transcript = await client.call('threads.transcript', { threadId: thread.id });
  expect(transcript.filter((i) => i.kind === 'notice')).toEqual([]);
  expect(first?.status).toBe('idle');
  expect(transcript).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'assistant', text: 'Native Codex reply.' })]));
  expect(requests[0]?.body).toMatchObject({ model: 'test-codex', stream: true, store: false });
  expect(requests[0]?.headers.get('chatgpt-account-id')).toBe('native');
  expect(requests[0]?.headers.get('authorization')).not.toContain('accio-');
  client.events.length = 0;
  await client.call('threads.send', { threadId: thread.id, text: 'Continue the conversation.' });
  await client.waitFor('threads.changed', (threads) => threads.some((t) => t.id === thread.id && t.status !== 'running'), 15_000);
  const after = await client.call('threads.transcript', { threadId: thread.id });
  expect(after.filter((i) => i.kind === 'notice')).toEqual([]);
  expect(after.filter((i) => i.kind === 'assistant')).toHaveLength(2);
  expect(requests).toHaveLength(2);
}, 40_000);
