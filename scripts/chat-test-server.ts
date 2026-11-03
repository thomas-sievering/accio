/** Isolated real server + deterministic harness for the committed chat browser checks. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { startApp } from '../apps/server/src/app.js';
import { FakeHarness, SESSION, replyWith } from '../apps/server/src/testing/fakeHarness.js';
import { fakeClaudeFetch, TestClient } from '../apps/server/src/testing/testApp.js';
import type { HarnessMessage } from '../apps/server/src/threads/harness.js';
import { git } from '../apps/server/src/threads/delivery.js';

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
  if (run.prompt === 'Build delivery fixture') {
    await writeFile(join(run.cwd, 'feature.txt'), 'A change owned by this thread.\n');
    yield { type: 'harness_event', event: { kind: 'text', id: 'delivery-progress', text: 'Feature implemented. Running checks…' } };
    await setTimeout(8000, undefined, { signal: run.signal }).catch(() => {});
    if (!run.signal.aborted) yield { type: 'harness_event', event: { kind: 'end' } };
    return;
  }
  if (run.prompt.startsWith('Deliver the current task')) {
    await git(run.cwd, 'add', '.');
    if (await git(run.cwd, 'status', '--porcelain')) await git(run.cwd, 'commit', '--quiet', '-m', 'delivery fixture');
    await git(run.cwd, 'fetch', '--quiet', 'origin');
    await git(run.cwd, 'rebase', 'origin/main');
    if (run.prompt.includes('NEVER merge')) await git(run.cwd, 'push', '--quiet', 'origin', 'HEAD');
    else await git(run.cwd, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main');
    yield* replyWith('Verification complete. Published the committed change.');
    return;
  }
  if (run.prompt === 'Skills fixture') {
    // A successful read of a repository skill's instructions: the Skills panel marks it loaded.
    const step = { id: 'skills-read', name: 'Read', input: { file_path: join(run.cwd, '.agents', 'skills', 'repo-notes', 'SKILL.md') } };
    yield { type: 'assistant', parent_tool_use_id: null, session_id: SESSION, message: { id: step.id, content: [{ type: 'tool_use', ...step }] } } as HarnessMessage;
    yield { type: 'user', parent_tool_use_id: null, session_id: SESSION, message: { content: [{ type: 'tool_result', tool_use_id: step.id, content: await readFile(step.input.file_path, 'utf8') }] } } as HarnessMessage;
    yield* replyWith('Read the repository notes skill.');
    return;
  }
  if (run.prompt === 'Delivery follow-up') { yield* replyWith('Fresh workspace ready.'); return; }
  if (run.prompt === 'append update') {
    yield* replyWith('Update complete');
    return;
  }
  if (run.prompt === 'long context') {
    yield* replyWith(Array.from({ length: 70 }, (_, index) => `Paragraph ${index + 1}: history that should stay readable while new output arrives.`).join('\n\n'));
    return;
  }
  if (run.prompt === 'explore tools') {
    // One call at a time, each long enough for a person (and the check) to see the status line change.
    const steps = [
      { id: 'explore-ls', name: 'Bash', input: { command: 'ls -la' }, result: 'README.md\nwebsite/\nworkflow/' },
      { id: 'explore-read', name: 'Read', input: { file_path: 'README.md' }, result: '# litewerks' },
      { id: 'explore-grep', name: 'Grep', input: { pattern: 'TODO' }, result: 'No matches' },
    ];
    for (const step of steps) {
      yield { type: 'assistant', parent_tool_use_id: null, session_id: SESSION, message: { id: step.id, content: [{ type: 'tool_use', id: step.id, name: step.name, input: step.input }] } } as HarnessMessage;
      await setTimeout(Number(process.env.ACCIO_CHAT_TOOL_DELAY ?? 700));
      yield { type: 'user', parent_tool_use_id: null, session_id: SESSION, message: { content: [{ type: 'tool_result', tool_use_id: step.id, content: step.result }] } } as HarnessMessage;
    }
    yield* replyWith('Explored the folder.');
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
const app = await startApp({ home, host: '127.0.0.1', port: Number(process.env.ACCIO_CHAT_TEST_PORT ?? 47481), hubPort: 0, token, webRoot: resolve('apps/web/dist') }, {
  harness,
  claudeFetch: (url, init) => String(url).endsWith('/api/oauth/usage')
    ? Promise.resolve(Response.json({ rate_limits_available: false })) : fakeClaudeFetch(url, init),
});
const client = await TestClient.open(`ws://127.0.0.1:${app.port}/ws?token=${token}`);
await client.signedIn('Personal');
const deliveryFolder = join(home, 'delivery-project');
const deliveryOrigin = join(home, 'delivery-origin.git');
await mkdir(deliveryFolder);
await git(deliveryFolder, 'init', '--quiet', '-b', 'main');
await git(deliveryFolder, 'config', 'user.name', 'Accio Browser Test');
await git(deliveryFolder, 'config', 'user.email', 'browser@example.test');
await git(deliveryFolder, 'config', 'core.autocrlf', 'false');
await writeFile(join(deliveryFolder, 'preview.cjs'), `require('http').createServer((req,res)=>res.end('Accio delivery preview')).listen(Number(process.env.PORT),'127.0.0.1');`);
await git(deliveryFolder, 'add', '.');
await git(deliveryFolder, 'commit', '--quiet', '-m', 'preview fixture');
await git(home, 'init', '--quiet', '--bare', '-b', 'main', deliveryOrigin);
await git(deliveryFolder, 'remote', 'add', 'origin', deliveryOrigin);
await git(deliveryFolder, 'push', '--quiet', '-u', 'origin', 'main');
await git(deliveryFolder, 'remote', 'set-head', 'origin', '-a');
const deliveryCheckout = await client.call('checkouts.add', { path: deliveryFolder, profileId: 'personal' });
await client.call('projects.setDelivery', { projectId: deliveryCheckout.projectId, deliveryPolicy: 'direct', previewCommand: 'node preview.cjs' });
// Skills panel: a project with one repository skill, and a library source with one profile skill and one optional.
const skillsFolder = join(home, 'skills-project');
const skillsLibrary = join(home, 'skills-library');
const skillFile = (name: string, description: string, body: string) => `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`;
for (const [folder, files] of [
  [skillsFolder, { '.agents/skills/repo-notes/SKILL.md': skillFile('repo-notes', 'How this repository writes notes', 'Write notes in plain sentences.') }],
  [skillsLibrary, {
    'lib-review/SKILL.md': skillFile('lib-review', 'Review a change before shipping', 'Review instructions.'),
    'lib-docs/SKILL.md': skillFile('lib-docs', 'Keep documentation current', 'Docs instructions.'),
  }],
] as const) {
  await mkdir(folder);
  await git(folder, 'init', '--quiet', '-b', 'main');
  await git(folder, 'config', 'user.name', 'Accio Browser Test');
  await git(folder, 'config', 'user.email', 'browser@example.test');
  await git(folder, 'config', 'core.autocrlf', 'false');
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(folder, path, '..'), { recursive: true });
    await writeFile(join(folder, path), content);
  }
  await git(folder, 'add', '.');
  await git(folder, 'commit', '--quiet', '-m', 'skills fixture');
}
const skillsCheckout = await client.call('checkouts.add', { path: skillsFolder, profileId: 'personal' });
await client.call('skills.addSource', { id: 'library', name: 'Library', url: skillsLibrary, ref: 'HEAD' });
const docs = (await client.call('resources.get', {})).skills.find((skill) => skill.name === 'lib-docs')!;
await client.call('skills.setScope', { id: docs.id, scope: { ...docs.scope, profileIds: ['personal'] } });
const skillsThread = await client.call('threads.start', { checkoutId: skillsCheckout.id, text: 'Skills fixture' });
await client.waitFor('threads.changed', (threads) => threads.some((entry) => entry.id === skillsThread.id && entry.status === 'idle'));
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
