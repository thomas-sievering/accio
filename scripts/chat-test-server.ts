/** Isolated real server + deterministic harness for the committed chat browser checks. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { startApp } from '../apps/server/src/app.js';
import { FakeHarness, SESSION, replyWith } from '../apps/server/src/testing/fakeHarness.js';
import { fakeClaudeFetch, TestClient } from '../apps/server/src/testing/testApp.js';
import type { HarnessMessage } from '../apps/server/src/threads/harness.js';
import { DeliveryGit, DeliveryPending, git } from '../apps/server/src/threads/delivery.js';

const home = await mkdtemp(join(tmpdir(), 'accio-chat-browser-'));
const fixture = (name: string) => readFile(resolve('tests/fixtures', name));
const token = 'isolated-chat-test-token';
const image = await fixture('chat.png');
const reviewHostFile = join(home, 'review-host.json');
let reviewFeature = 0;
let deliveryFeature = 0;
// The delivery verification boundary supplies deterministic CI snapshots; Git publication stays real.
const verifyDelivery = DeliveryGit.prototype.verify;
const ciPolls = new Map<string, number>();
DeliveryGit.prototype.verify = async function(workspace, delivery, observed) {
  if (ciPolls.has(workspace.path)) {
    const poll = (ciPolls.get(workspace.path) ?? 0) + 1;
    ciPolls.set(workspace.path, poll);
    if (poll < 3) throw new DeliveryPending('Waiting for checks to finish.', false, 'checks', {
      revision: await git(workspace.path, 'rev-parse', 'HEAD'), updatedAt: new Date().toISOString(), checks: [
        { name: 'verify', status: 'success' },
        { name: 'image', status: 'in_progress', url: 'https://github.com/test/fixture/actions/runs/10/job/20', step: { name: poll === 1 ? 'Build image' : 'Push image', current: poll === 1 ? 2 : 3, total: 4 } },
      ],
    });
  }
  return verifyDelivery.call(this, workspace, delivery, observed);
};
const harness = new FakeHarness(async function* (run) {
  if (run.prompt === 'Build CI progress fixture') {
    ciPolls.set(run.cwd, 0);
    await writeFile(join(run.cwd, 'ci-fixture.txt'), 'CI progress');
    yield* replyWith('CI fixture ready.');
    return;
  }
  if (run.prompt === 'Steering fixture') {
    const messages: string[] = [];
    let finished = false;
    let wake = () => {};
    const abort = () => { finished = true; wake(); };
    run.signal.addEventListener('abort', abort, { once: true });
    run.registerSteer?.(async text => {
      messages.push(text);
      if (text === 'Finish steering fixture') finished = true;
      wake();
    });
    try {
      yield { type: 'harness_event', event: { kind: 'text', id: 'steer-ready', text: 'Waiting for steering.' } };
      let n = 0;
      while (!finished || messages.length) {
        const text = messages.shift();
        if (!text) { await new Promise<void>(resolve => { wake = resolve; }); continue; }
        yield { type: 'harness_event', event: { kind: 'text', id: `steered-${n++}`, text: `Steered: ${text}` } };
      }
      if (!run.signal.aborted) yield { type: 'harness_event', event: { kind: 'end' } };
    } finally { run.registerSteer?.(undefined); run.signal.removeEventListener('abort', abort); }
    return;
  }
  if (run.prompt.startsWith('Queued ')) { yield* replyWith(`Finished: ${run.prompt}`); return; }
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
    await writeFile(join(run.cwd, 'feature.txt'), `A change owned by this thread: ${++deliveryFeature}.\n`);
    yield { type: 'harness_event', event: { kind: 'text', id: 'delivery-progress', text: 'Feature implemented. Running checks…' } };
    await setTimeout(8000, undefined, { signal: run.signal }).catch(() => {});
    if (!run.signal.aborted) yield { type: 'harness_event', event: { kind: 'end' } };
    return;
  }
  if (run.prompt === 'Build review fixture') {
    await writeFile(join(run.cwd, 'review-feature.txt'), `A feature prepared for human review: ${++reviewFeature}.\n`);
    yield* replyWith('Review feature implemented.');
    return;
  }
  if (run.prompt.startsWith('Deliver the current task')) {
    await git(run.cwd, 'add', '.');
    if (await git(run.cwd, 'status', '--porcelain')) await git(run.cwd, 'commit', '--quiet', '-m', 'delivery fixture');
    await git(run.cwd, 'fetch', '--quiet', 'origin');
    await git(run.cwd, 'rebase', 'origin/main');
    if (run.prompt.includes('NEVER merge')) {
      await git(run.cwd, 'push', '--quiet', 'origin', 'HEAD');
      await writeFile(reviewHostFile, JSON.stringify({ state: 'OPEN', checks: 'SUCCESS', head: await git(run.cwd, 'rev-parse', 'HEAD'), branch: await git(run.cwd, 'branch', '--show-current') }));
    }
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
      { type: 'tool_use', id: 'failed-tool', name: 'Bash', input: { command: String.raw`"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command 'fixture-failure'` } },
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
  // Hosting is the external boundary under test. Git publication and thread state stay real.
  deliveryHosting: async (_cwd, args) => {
    const host = JSON.parse(await readFile(reviewHostFile, 'utf8'));
    if (args[0] === 'pr') {
      const pr = { number: 123, url: 'https://github.com/test/accio-review/pull/123', state: host.state, headRefOid: host.head,
        baseRefName: 'main', isDraft: false, reviewDecision: '', statusCheckRollup: [{ conclusion: 'SUCCESS' }],
        mergeCommit: host.mergeRevision ? { oid: host.mergeRevision } : null, mergedAt: host.mergedAt };
      return args[1] === 'view' ? pr : [pr];
    }
    return args[1]!.includes('check-runs') ? { total_count: 1, check_runs: [{ conclusion: host.checks === 'PENDING' ? null : host.checks }] } : { total_count: 0, statuses: [] };
  },
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
const reviewFolder = join(home, 'review-project');
const reviewOrigin = join(home, 'review-origin.git');
await mkdir(reviewFolder);
await git(reviewFolder, 'init', '--quiet', '-b', 'main');
await git(reviewFolder, 'config', 'user.name', 'Accio Browser Test');
await git(reviewFolder, 'config', 'user.email', 'browser@example.test');
await writeFile(join(reviewFolder, 'seed.txt'), 'review base\n');
await git(reviewFolder, 'add', '.');
await git(reviewFolder, 'commit', '--quiet', '-m', 'review base');
await git(home, 'init', '--quiet', '--bare', '-b', 'main', reviewOrigin);
await git(reviewFolder, 'remote', 'add', 'origin', reviewOrigin);
await git(reviewFolder, 'push', '--quiet', '-u', 'origin', 'main');
await git(reviewFolder, 'remote', 'set-head', 'origin', '-a');
await git(reviewFolder, 'config', `url.${reviewOrigin.replaceAll('\\', '/')}.insteadOf`, 'https://github.com/test/accio-review.git');
await git(reviewFolder, 'remote', 'set-url', 'origin', 'https://github.com/test/accio-review.git');
await client.call('checkouts.add', { path: reviewFolder, profileId: 'personal' });
await mkdir(resolve('out'), { recursive: true });
const fixtureMetadata = resolve('out', `chat-test-${app.port}.json`);
await writeFile(fixtureMetadata, JSON.stringify({ deliveryFolder, deliveryOrigin, reviewFolder, reviewOrigin, reviewHostFile }));
// CI progress publishes to a separate disposable origin, preserving other delivery scenarios' starting main.
const ciOrigin = join(home, 'ci-origin.git');
const ciFolder = join(home, 'ci-progress-project');
await git(home, 'clone', '--quiet', '--bare', deliveryFolder, ciOrigin);
await git(home, 'clone', '--quiet', ciOrigin, ciFolder);
await git(ciFolder, 'config', 'user.name', 'Accio Browser Test');
await git(ciFolder, 'config', 'user.email', 'browser@example.test');
await client.call('checkouts.add', { path: ciFolder, profileId: 'personal' });
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
// MCP tab: a remote server that still needs signing in, and a local one.
await client.call('mcp.save', { id: 'docs-search', name: 'docs-search', transport: 'http', url: 'https://mcp.example.test/docs', args: [], auth: 'oauth' });
await client.call('mcp.save', { id: 'local-db', name: 'local-db', transport: 'stdio', command: 'db-mcp', args: ['--readonly'], auth: 'none' });
console.log(`Chat fixture ready: http://127.0.0.1:${app.port}`);
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  client.close();
  await app.close();
  await rm(fixtureMetadata, { force: true });
  await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  process.exit();
};
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
