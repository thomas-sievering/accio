/** Isolated real server + deterministic harness for the committed chat browser checks. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { startApp } from '../apps/server/src/app.js';
import { FakeHarness, SESSION, replyWith } from '../apps/server/src/testing/fakeHarness.js';
import { fakeClaudeFetch, TestClient } from '../apps/server/src/testing/testApp.js';
import type { HarnessMessage } from '../apps/server/src/threads/harness.js';

const home = await mkdtemp(join(tmpdir(), 'accio-chat-browser-'));
const fixture = (name: string) => readFile(resolve('tests/fixtures', name));
const token = 'isolated-chat-test-token';
const image = await fixture('chat.png');
const harness = new FakeHarness(async function* (run) {
  if (run.prompt === 'Choice fixture') {
    const options = [['choice-list.png', 'List rows'], ['choice-cards.png', 'Cards'], ['choice-grouped.png', 'Grouped by provider']];
    for (const [name] of options) await writeFile(join(run.cwd, name!), await fixture(name!));
    const input = { question: 'Which Accounts layout?', options: options.map(([path, label]) => ({ path, label })) };
    yield { type: 'assistant', parent_tool_use_id: null, session_id: SESSION, message: { id: 'choice', content: [{ type: 'tool_use', id: 'choice-1', name: 'mcp__accio__offer_choice', input }] } } as HarnessMessage;
    yield { type: 'user', parent_tool_use_id: null, session_id: SESSION, message: { content: [{ type: 'tool_result', tool_use_id: 'choice-1', content: 'shown' }] } } as HarnessMessage;
    yield { type: 'result', subtype: 'success', is_error: false, session_id: SESSION };
    return;
  }
  if (run.prompt.startsWith('I pick ')) {
    yield* replyWith(`Got it: ${run.prompt.split('\n')[0]}`);
    return;
  }
  if (run.prompt === 'append update') {
    yield* replyWith('Update complete');
    return;
  }
  if (run.prompt === 'long context') {
    yield* replyWith(Array.from({ length: 70 }, (_, index) => `Paragraph ${index + 1}: history that should stay readable while new output arrives.`).join('\n\n'));
    return;
  }
  if (run.prompt === 'stream update') {
    const id = 'streamed-update';
    yield { type: 'stream_event', parent_tool_use_id: null, session_id: SESSION, event: { type: 'message_start', message: { id } } };
    yield { type: 'stream_event', parent_tool_use_id: null, session_id: SESSION, event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } };
    for (let index = 0; index < 12; index++) {
      yield { type: 'stream_event', parent_tool_use_id: null, session_id: SESSION, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Streaming text. ' } } };
      await setTimeout(35);
    }
    yield { type: 'assistant', parent_tool_use_id: null, session_id: SESSION, message: { id, content: [{ type: 'text', text: 'Streaming text. '.repeat(12) + 'Stream complete' }] } };
    yield { type: 'result', subtype: 'success', is_error: false, session_id: SESSION };
    return;
  }
  for (const name of ['chat.png', 'chat.webm', 'chat.ogg']) await writeFile(join(run.cwd, name), await fixture(name));
  for (const name of ['my image.png', '漢字.png', 'literal%20image.png']) await writeFile(join(run.cwd, name), image);
  await writeFile(join(run.cwd, 'notes.txt'), 'The current notes file.');
  await writeFile(join(run.cwd, 'my notes.txt'), 'Notes with spaces.');
  yield { type: 'assistant', parent_tool_use_id: null, session_id: SESSION, message: { id: 'tools', content: [
    { type: 'tool_use', id: 'success-tool', name: 'Read', input: { file_path: 'chat.png', offset: 3 } },
    { type: 'tool_use', id: 'failed-tool', name: 'Bash', input: { command: 'fixture-failure' } },
  ] } } as HarnessMessage;
  yield { type: 'user', parent_tool_use_id: null, session_id: SESSION, message: { content: [
    { type: 'tool_result', tool_use_id: 'success-tool', content: [
      { type: 'text', text: 'Before tool image' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image.toString('base64') } },
      { type: 'text', text: 'Complete output.\n'.repeat(400) + 'FULL_OUTPUT_TAIL' },
    ] },
    { type: 'tool_result', tool_use_id: 'failed-tool', is_error: true, content: 'Expected fixture failure' },
  ] } } as HarnessMessage;
  yield* replyWith('![Saved picture](chat.png)\n\n![Space picture](<my image.png>)\n\n![Unicode picture](漢字.png)\n\n![Literal percent picture](literal%2520image.png)\n\n' +
    `![Absolute picture](<${join(run.cwd, 'chat.png')}>)\n\n` +
    '![Demo clip](chat.webm)\n\n![Demo sound](chat.ogg)\n\n[Current notes](notes.txt)\n\n[Space notes](<my notes.txt>)\n\n![Missing picture](missing.png)');
  // The first browser view occurs after these source files have gone away.
  for (const name of ['chat.png', 'chat.webm', 'chat.ogg', 'my image.png', '漢字.png', 'literal%20image.png']) await rm(join(run.cwd, name));
});
const app = await startApp({ home, host: '127.0.0.1', port: Number(process.env.ACCIO_CHAT_TEST_PORT ?? 47481), hubPort: 0, token, webRoot: resolve('apps/web/dist') }, { harness, claudeFetch: fakeClaudeFetch });
const client = await TestClient.open(`ws://127.0.0.1:${app.port}/ws?token=${token}`);
await client.signedIn('Personal');
const thread = await client.call('threads.start', { profileId: 'personal', text: 'Inline chat fixture' });
await client.waitFor('threads.changed', (threads) => threads.some((entry) => entry.id === thread.id && entry.status === 'idle'));
const choice = await client.call('threads.start', { profileId: 'personal', text: 'Choice fixture' });
await client.waitFor('threads.changed', (threads) => threads.some((entry) => entry.id === choice.id && entry.status === 'idle'));
console.log(`Chat fixture ready: http://127.0.0.1:${app.port}`);
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  client.close();
  await app.close();
  await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  process.exit();
};
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
