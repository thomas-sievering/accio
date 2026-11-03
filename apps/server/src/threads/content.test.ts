import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { FakeHarness, SESSION, replyWith } from '../testing/fakeHarness.js';
import { startTestApp } from '../testing/testApp.js';
import type { HarnessMessage } from './harness.js';
import { MAX_DETAIL_CHARACTERS } from './content.js';
import { markdownReferences } from './markdown.js';

const fixture = (name: string) => readFile(fileURLToPath(new URL(`../../../../tests/fixtures/${name}`, import.meta.url)));
let t: Awaited<ReturnType<typeof startTestApp>>;
afterEach(() => t?.stop());

it('parses actual Markdown embeds/reference links without granting references mentioned in code', () => {
  expect(markdownReferences('![preview][image]\n\n[image]: <C:/work/my image.png>\n\n[Read](notes.md#L12)\n\n`![fake](secret.png)`\n\n```md\n[hidden](secret.txt)\n```')).toEqual({
    media: ['C:/work/my%20image.png'], files: ['notes.md#L12'],
  });
});

it('uses renderer-compatible destination encoding without double-decoding literal percent sequences', () => {
  expect(markdownReferences('![one](<my image.png>) ![two](<漢字.png>) ![literal](my%2520image.png)\n\n[Notes](<my notes.txt>)')).toEqual({
    media: ['my%20image.png', '%E6%BC%A2%E5%AD%97.png', 'my%2520image.png'], files: ['my%20notes.txt'],
  });
});

it('snapshots local media before the first observation and replays the same bytes after deletion and restart', async () => {
  const { rm } = await import('node:fs/promises');
  const names = ['chat.png', 'chat.webm', 'chat.ogg'];
  const bytes = await Promise.all(names.map(fixture));
  const harness = new FakeHarness(async function* (run) {
    for (let index = 0; index < names.length; index++) await writeFile(join(run.cwd, names[index]!), bytes[index]!);
    const text = names.map((name) => `![${name}](${name})`).join('\n\n');
    yield* replyWith(text);
    for (const name of names) await rm(join(run.cwd, name));
  });
  t = await startTestApp({ harness });
  const c = await t.connect();
  await c.signedIn('Personal');
  const thread = await c.call('threads.start', { profileId: 'personal', text: 'Media history' });
  await c.waitFor('threads.changed', (threads) => threads.some((entry) => entry.id === thread.id && entry.status === 'idle'));
  const home = t.home;
  await t.stop({ keepHome: true });
  t = await startTestApp({ harness: new FakeHarness() }, home);
  const restored = await t.connect();
  const snapshot = await restored.call('threads.observe', { threadId: thread.id });
  const assistant = snapshot.items.find((item) => item.kind === 'assistant');
  expect(assistant?.kind).toBe('assistant');
  if (assistant?.kind !== 'assistant') throw new Error('Missing assistant message');
  expect(assistant.media).toHaveLength(3);
  for (let index = 0; index < names.length; index++) {
    const asset = assistant.media![index]!.asset!;
    expect(asset).toMatchObject({ name: names[index], sizeBytes: bytes[index]!.length });
    const grant = await restored.call('threads.assetUrl', { threadId: thread.id, assetId: asset.id });
    expect(Buffer.from(await (await fetch(`http://127.0.0.1:${t.app.port}${grant.url}`)).arrayBuffer())).toEqual(bytes[index]);
  }
});

it('keeps ordered tool details and original input with bounded previews, and isolates asset/file grants by thread', async () => {
  const image = await fixture('chat.png');
  const output = 'A'.repeat(12_000);
  const harness = new FakeHarness(function* () {
    yield { type: 'assistant', parent_tool_use_id: null, session_id: SESSION, message: { id: 'tools', content: [
      { type: 'tool_use', id: 'read-image', name: 'Read', input: { file_path: 'chat.png', offset: 3 } },
    ] } } as HarnessMessage;
    yield { type: 'user', parent_tool_use_id: null, session_id: SESSION, message: { content: [
      { type: 'tool_result', tool_use_id: 'read-image', content: [
        { type: 'text', text: 'before' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image.toString('base64') } },
        { type: 'text', text: output },
      ] },
    ] } } as HarnessMessage;
    yield* replyWith('[Current notes](notes.txt)');
  });
  t = await startTestApp({ harness });
  const c = await t.connect();
  await c.signedIn('Personal');
  const thread = await c.call('threads.start', { profileId: 'personal', text: 'Inspect output' });
  await c.waitFor('threads.changed', (threads) => threads.some((entry) => entry.id === thread.id && entry.status === 'idle'));
  const snapshot = await c.call('threads.observe', { threadId: thread.id });
  const tool = snapshot.items.find((item) => item.kind === 'tool');
  expect(tool).toMatchObject({ status: 'done', detailRevision: 2 });
  expect(tool?.kind === 'tool' && tool.output!.length).toBeLessThanOrEqual(4000);
  expect(JSON.stringify(snapshot)).not.toContain(image.toString('base64'));
  const details = await c.call('threads.toolDetails', { threadId: thread.id, itemId: 'read-image' });
  expect(details.input).toEqual({ file_path: 'chat.png', offset: 3 });
  expect(details.parts.map((part) => part.type)).toEqual(['text', 'media', 'text']);
  expect(details.parts[2]).toEqual({ type: 'text', text: output });
  expect(JSON.stringify(details)).not.toContain(image.toString('base64'));
  const asset = details.parts[1]!.type === 'media' ? details.parts[1].asset : undefined;
  if (!asset) throw new Error('Missing tool image');
  const other = await c.call('threads.start', { profileId: 'personal', text: 'Other thread' });
  await c.waitFor('threads.changed', (threads) => threads.some((entry) => entry.id === other.id && entry.status === 'idle'));
  await expect(c.call('threads.assetUrl', { threadId: other.id, assetId: asset.id })).rejects.toThrow();
  await expect(c.call('threads.fileUrl', { threadId: thread.id, path: 'private.txt' })).rejects.toThrow(/not linked/);
  const notes = join(harness.runs[0]!.cwd, 'notes.txt');
  await writeFile(notes, 'version 1');
  const first = await c.call('threads.fileUrl', { threadId: thread.id, path: 'notes.txt' });
  await writeFile(notes, 'version 2');
  expect(await (await fetch(`http://127.0.0.1:${t.app.port}${first.url}`)).text()).toBe('version 2');
  const imageGrant = await c.call('threads.assetUrl', { threadId: thread.id, assetId: asset.id });
  await c.call('threads.delete', { threadId: thread.id });
  expect((await fetch(`http://127.0.0.1:${t.app.port}${imageGrant.url}`)).status).toBe(404);
});

it('retains output up to an explicit detail limit and keeps old transcripts readable', async () => {
  const harness = new FakeHarness(function* () {
    yield { type: 'assistant', parent_tool_use_id: null, session_id: SESSION, message: { id: 'm', content: [{ type: 'tool_use', id: 'large', name: 'Bash', input: { command: 'output' } }] } } as HarnessMessage;
    yield { type: 'user', parent_tool_use_id: null, session_id: SESSION, message: { content: [{ type: 'tool_result', tool_use_id: 'large', content: 'x'.repeat(MAX_DETAIL_CHARACTERS + 100) }] } } as HarnessMessage;
    yield* replyWith('Done');
  });
  t = await startTestApp({ harness });
  const c = await t.connect();
  await c.signedIn('Personal');
  const thread = await c.call('threads.start', { profileId: 'personal', text: 'Large tool result' });
  await c.waitFor('threads.changed', (threads) => threads.some((entry) => entry.id === thread.id && entry.status === 'idle'));
  const details = await c.call('threads.toolDetails', { threadId: thread.id, itemId: 'large' });
  expect(details.truncated).toBe(true);
  expect(details.parts[0]).toEqual({ type: 'text', text: 'x'.repeat(MAX_DETAIL_CHARACTERS) });
  const home = t.home;
  await t.stop({ keepHome: true });
  await writeFile(join(home, 'transcripts', `${thread.id}.json`), JSON.stringify([
    { kind: 'tool', id: 'legacy', turnId: 'old', name: 'Bash', summary: 'echo old', status: 'done', output: 'old output' },
  ]));
  t = await startTestApp({ harness: new FakeHarness() }, home);
  const restored = await t.connect();
  expect(await restored.call('threads.toolDetails', { threadId: thread.id, itemId: 'legacy' })).toEqual({ input: null, parts: [{ type: 'text', text: 'old output' }] });
});
