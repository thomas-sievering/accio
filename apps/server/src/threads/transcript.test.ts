import { describe, expect, it } from 'vitest';
import type { ContentBlock, HarnessMessage } from './harness.js';
import { harnessEnv } from './harnessEnv.js';
import { summarizeTool, TurnTranscript, type TranscriptChange } from './transcript.js';

const S = 'sess-1';
const stream = (event: object): HarnessMessage => ({ type: 'stream_event', event, parent_tool_use_id: null, session_id: S }) as HarnessMessage;
const assistant = (content: ContentBlock[], id = 'm1', uuid?: string): Extract<HarnessMessage, { type: 'assistant' }> => ({ type: 'assistant', uuid, message: { id, content }, parent_tool_use_id: null, session_id: S });
const result = (content: unknown, is_error = false): HarnessMessage => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content, is_error }] }, parent_tool_use_id: null, session_id: S });
const toolChanges = (changes: TranscriptChange[]) => changes.filter((change): change is Extract<TranscriptChange, { type: 'tool' }> => change.type === 'tool');

describe('TurnTranscript', () => {
  it('shortens shell summaries before clipping and preserves the full input', () => {
    const t = new TurnTranscript('t1');
    const script = 'Get-Content ' + 'a'.repeat(220);
    const command = `"C:\\\\WINDOWS\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" -Command '${script}'`;
    const [change] = toolChanges(t.accept({ type: 'harness_event', event: {
      kind: 'tool', id: 'shell', name: 'Shell', summary: command, input: { command }, status: 'running',
    } }));
    expect(change!.item.summary).toBe(script.slice(0, 199) + '…');
    expect(change!.input).toEqual({ command });
    expect(summarizeTool('Read', { file_path: command })).toBe(command.slice(0, 199) + '…');
  });

  it('keeps full harness-neutral tool details separate from previews and closes interrupted tools', () => {
    const t = new TurnTranscript('t1');
    const tool = { kind: 'tool' as const, id: 'cmd', name: 'Shell', summary: 'git status\necho done' };
    const start = toolChanges(t.accept({ type: 'harness_event', event: { ...tool, status: 'running' } }))[0]!;
    expect(start).toMatchObject({ item: { id: 't1:cmd', summary: 'git status', status: 'running', detailRevision: 1 }, input: tool.summary });
    const output = 'full output\n'.repeat(1_000);
    const done = toolChanges(t.accept({ type: 'harness_event', event: { ...tool, status: 'done', output } }))[0]!;
    expect(done.content).toBe(output);
    expect(done.item.output?.length).toBeLessThanOrEqual(4_000);
    expect(done.item.detailRevision).toBe(2);
    expect(t.unfinishedTools()).toEqual([]);
    t.accept({ type: 'harness_event', event: { ...tool, id: 'pending', status: 'running' } });
    expect(t.unfinishedTools('interrupted')).toEqual([expect.objectContaining({ id: 't1:pending', status: 'interrupted' })]);
    expect(t.unfinishedTools()).toEqual([]);
  });

  it('streams text, then confirms it with the full message under the same id', () => {
    const t = new TurnTranscript('t1');
    const changes = [
      { type: 'system', subtype: 'init', session_id: S },
      stream({ type: 'message_start', message: { id: 'm1' } }),
      stream({ type: 'content_block_start', index: 0, content_block: { type: 'text' } }),
      stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } }),
      stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } }),
      { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Hello' }] }, parent_tool_use_id: null, session_id: S },
      { type: 'result', subtype: 'success', is_error: false, session_id: S },
    ].flatMap((m) => t.accept(m as HarnessMessage));

    expect(changes[0]).toEqual({ type: 'session', sessionId: S });
    const created = changes[1] as { type: 'item'; item: { id: string } };
    expect(changes.slice(2, 4)).toEqual([
      { type: 'delta', itemId: created.item.id, text: 'Hel' },
      { type: 'delta', itemId: created.item.id, text: 'lo' },
    ]);
    expect(changes[4]).toEqual({ type: 'item', item: { kind: 'assistant', id: created.item.id, turnId: 't1', text: 'Hello' } });
    expect(changes[5]).toEqual({ type: 'end', outcome: 'completed' });
  });

  it('shows tool calls and their results, but not subagent messages', () => {
    const t = new TurnTranscript('t1');
    const changes = [
      {
        type: 'assistant',
        message: { id: 'm1', content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls -la\necho hi' } }] },
        parent_tool_use_id: null,
        session_id: S,
      },
      {
        type: 'assistant',
        message: { id: 'm2', content: [{ type: 'text', text: 'from a subagent' }] },
        parent_tool_use_id: 'tu9',
        session_id: S,
      },
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: [{ type: 'text', text: 'file.txt' }] }] },
        parent_tool_use_id: null,
        session_id: S,
      },
    ].flatMap((m) => t.accept(m as HarnessMessage));

    expect(changes).toEqual([
      { type: 'tool', item: { kind: 'tool', id: 'tu1', turnId: 't1', name: 'Bash', summary: 'ls -la', status: 'running', detailRevision: 1 }, input: { command: 'ls -la\necho hi' } },
      {
        type: 'tool',
        item: { kind: 'tool', id: 'tu1', turnId: 't1', name: 'Bash', summary: 'ls -la', status: 'done', output: 'file.txt', detailRevision: 2 },
        input: { command: 'ls -la\necho hi' },
        content: [{ type: 'text', text: 'file.txt' }],
      },
    ]);
  });

  it('reports a failed turn with its error', () => {
    const t = new TurnTranscript('t1');
    const changes = t.accept({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      session_id: S,
      errors: ['401 from hub'],
    } as HarnessMessage);
    expect(changes).toEqual([
      { type: 'item', item: { kind: 'notice', id: 't1:n0', turnId: 't1', tone: 'error', text: '401 from hub' } },
      { type: 'end', outcome: 'failed', error: '401 from hub' },
    ]);
  });

  it('marks tools left running as errored when the turn stops early', () => {
    const t = new TurnTranscript('t1');
    t.accept({
      type: 'assistant',
      message: { id: 'm1', content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: 'a.ts' } }] },
      parent_tool_use_id: null,
      session_id: S,
    } as HarnessMessage);
    expect(t.unfinishedTools()).toEqual([{ kind: 'tool', id: 'tu1', turnId: 't1', name: 'Read', summary: 'a.ts', status: 'error', detailRevision: 1 }]);
    expect(t.unfinishedTools()).toEqual([]);
  });

  it('creates tool rows at block start and completes streamed JSON before the final message', () => {
    const t = new TurnTranscript('t1');
    t.accept(stream({ type: 'message_start', message: { id: 'm1' } }));
    const start = t.accept(stream({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu1', name: 'Bash', input: {} } }));
    expect(start).toEqual([{ type: 'tool', item: { kind: 'tool', id: 'tu1', turnId: 't1', name: 'Bash', summary: '', status: 'running', detailRevision: 1 }, input: {} }]);
    expect(t.accept(stream({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"command":' } }))).toEqual([]);
    t.accept(stream({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"pwd"}' } }));
    const completed = toolChanges(t.accept(stream({ type: 'content_block_stop', index: 0 })));
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ input: { command: 'pwd' }, item: { id: 'tu1', summary: 'pwd', detailRevision: 2 } });
    expect(t.accept(assistant([{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'pwd' } }]))).toEqual([]);
    expect(t.accept(stream({ type: 'content_block_stop', index: 0 }))).toEqual([]);
    expect(toolChanges(t.accept(result('cwd')))[0]).toMatchObject({ input: { command: 'pwd' }, content: 'cwd', item: { status: 'done', detailRevision: 3 } });
  });

  it('keeps indexed text/tool/text blocks ordered and reconciles the final message without duplicates', () => {
    const t = new TurnTranscript('t1');
    const streamed = [
      stream({ type: 'message_start', message: { id: 'm1' } }),
      stream({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }),
      stream({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }),
      stream({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Before' } }),
      stream({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'tu1', name: 'Read', input: {} } }),
      stream({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"file_path":"a.ts"}' } }),
      stream({ type: 'content_block_stop', index: 2 }),
      stream({ type: 'content_block_start', index: 3, content_block: { type: 'text', text: '' } }),
      stream({ type: 'content_block_delta', index: 3, delta: { type: 'text_delta', text: 'After' } }),
    ].flatMap((message) => t.accept(message));
    const created = streamed.filter((change) => change.type === 'item' || change.type === 'tool');
    expect(created.map((change) => change.item.id)).toEqual(['t1:a0', 'tu1', 'tu1', 't1:a1']);
    // A late delta still targets its own block, rather than the most recent text item.
    expect(t.accept(stream({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '!' } }))).toEqual([{ type: 'delta', itemId: 't1:a0', text: '!' }]);
    const final = assistant([
      { type: 'thinking' },
      { type: 'text', text: 'Before!' },
      { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: 'a.ts' } },
      { type: 'text', text: 'After' },
    ]);
    expect(t.accept(final)).toEqual([
      { type: 'item', item: { kind: 'assistant', id: 't1:a0', turnId: 't1', text: 'Before!' } },
      { type: 'item', item: { kind: 'assistant', id: 't1:a1', turnId: 't1', text: 'After' } },
    ]);
    expect(t.accept(final)).toEqual([]);
    expect(t.accept(result('file contents'))).toHaveLength(1);
    expect(t.accept(final)).toEqual([]);
    expect(t.accept(result('file contents'))).toEqual([]);
  });

  it('reconciles partial assistant snapshots using stable block ids', () => {
    const t = new TurnTranscript('t1');
    const partial = t.accept(assistant([{ type: 'text', text: 'Part' }]));
    expect(partial).toEqual([{ type: 'item', item: { kind: 'assistant', id: 't1:a0', turnId: 't1', text: 'Part' } }]);
    const final = assistant([
      { type: 'text', text: 'Partial answer' },
      { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: 'a.ts' } },
      { type: 'text', text: 'After' },
    ]);
    expect(t.accept(final)).toMatchObject([
      { type: 'item', item: { id: 't1:a0', text: 'Partial answer' } },
      { type: 'tool', item: { id: 'tu1', detailRevision: 1 } },
      { type: 'item', item: { id: 't1:a1', text: 'After' } },
    ]);
    expect(t.accept(final)).toEqual([]);
  });

  it('reconciles SDK text/tool/text block fragments sharing one message id', () => {
    const t = new TurnTranscript('t1');
    const first = assistant([{ type: 'text', text: 'Before' }], 'm1', 'envelope-1');
    const call = assistant([{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: 'a.ts' } }], 'm1', 'envelope-2');
    const last = assistant([{ type: 'text', text: 'After' }], 'm1', 'envelope-3');
    const changes = [
      stream({ type: 'message_start', message: { id: 'm1' } }),
      stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Before' } }),
      stream({ type: 'content_block_stop', index: 0 }),
      first,
      stream({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu1', name: 'Read', input: {} } }),
      stream({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"file_path":"a.ts"}' } }),
      stream({ type: 'content_block_stop', index: 1 }),
      call,
      stream({ type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } }),
      stream({ type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'After' } }),
      stream({ type: 'content_block_stop', index: 2 }),
      last,
    ].flatMap((message) => t.accept(message));
    const textItems = changes.filter((change) => change.type === 'item' && change.item.kind === 'assistant');
    expect(textItems).toMatchObject([
      { item: { id: 't1:a0', text: '' } },
      { item: { id: 't1:a0', text: 'Before' } },
      { item: { id: 't1:a1', text: '' } },
      { item: { id: 't1:a1', text: 'After' } },
    ]);
    const timeline = new Map<string, unknown>();
    for (const change of changes) {
      if (change.type === 'item' || change.type === 'tool') timeline.set(change.item.id, change.item);
    }
    expect([...timeline.keys()]).toEqual(['t1:a0', 'tu1', 't1:a1']);
    expect([...timeline.values()]).toMatchObject([{ text: 'Before' }, { name: 'Read' }, { text: 'After' }]);
    expect([first, call, last].flatMap((message) => t.accept(message))).toEqual([]);
    expect(t.accept(assistant([...first.message.content, ...call.message.content, ...last.message.content]))).toEqual([]);
  });

  it('appends SDK fragments without streaming and uses envelope UUIDs to distinguish identical blocks', () => {
    const t = new TurnTranscript('t1');
    const first = assistant([{ type: 'text', text: 'Repeated text' }], 'm1', 'envelope-1');
    const call = assistant([{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: 'a.ts' } }], 'm1', 'envelope-2');
    const last = assistant([{ type: 'text', text: 'Repeated text' }], 'm1', 'envelope-3');
    expect([first, call, last].flatMap((message) => t.accept(message))).toMatchObject([
      { type: 'item', item: { id: 't1:a0', text: 'Repeated text' } },
      { type: 'tool', item: { id: 'tu1' } },
      { type: 'item', item: { id: 't1:a1', text: 'Repeated text' } },
    ]);
    expect([last, first, call].flatMap((message) => t.accept(message))).toEqual([]);
  });

  it('appends distinct fragments without UUIDs rather than overwriting the first block', () => {
    const t = new TurnTranscript('t1');
    const first = assistant([{ type: 'text', text: 'Before' }]);
    const call = assistant([{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: 'a.ts' } }]);
    const last = assistant([{ type: 'text', text: 'After' }]);
    expect([first, call, last].flatMap((message) => t.accept(message))).toMatchObject([
      { type: 'item', item: { id: 't1:a0', text: 'Before' } },
      { type: 'tool', item: { id: 'tu1' } },
      { type: 'item', item: { id: 't1:a1', text: 'After' } },
    ]);
    expect([first, call, last].flatMap((message) => t.accept(message))).toEqual([]);
  });

  it('retains full ordered raw results while keeping binary data out of transcript previews', () => {
    const t = new TurnTranscript('t1');
    const input = { file_path: 'image.png' };
    t.accept(assistant([{ type: 'tool_use', id: 'tu1', name: 'Read', input }]));
    const content = [
      { type: 'text', text: 'Before' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'secret-base64-data' } },
      { type: 'text', text: 'After' },
      { type: 'unfamiliar', data: 'secret-base64-data' },
      { type: 'text', text: 'data:image/png;base64,SGVsbG8=' },
    ];
    const change = toolChanges(t.accept(result(content)))[0];
    expect(change?.input).toEqual(input);
    expect(change?.content).toBe(content);
    expect(change?.item.output).toBe('Before\n[image]\nAfter\n[Unsupported content: unfamiliar]\n[inline data omitted]');
    expect(JSON.stringify(change?.item)).not.toContain('secret-base64-data');
  });

  it('bounds previews without truncating full result content and emits changed results once', () => {
    const t = new TurnTranscript('t1');
    t.accept(assistant([{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'long-output' } }]));
    const content = '0123456789'.repeat(10_000);
    const change = toolChanges(t.accept(result(content)))[0];
    expect(change?.content).toBe(content);
    expect(change?.item.output?.length).toBeLessThanOrEqual(4000);
    expect(change?.item.output).toContain('preview truncated');
    expect(t.accept(result(content))).toEqual([]);
    expect(toolChanges(t.accept(result('updated')))[0]?.item).toMatchObject({ output: 'updated', detailRevision: 3 });
  });

  it('keeps incomplete streamed arguments visible until a final message repairs them', () => {
    const t = new TurnTranscript('t1');
    t.accept(stream({ type: 'message_start', message: { id: 'm1' } }));
    t.accept(stream({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu1', name: 'Read', input: {} } }));
    t.accept(stream({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"file_path":' } }));
    expect(toolChanges(t.accept(stream({ type: 'content_block_stop', index: 0 })))[0]?.input).toBe('{"file_path":');
    expect(toolChanges(t.accept(assistant([{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: 'a.ts' } }])))[0]).toMatchObject({ input: { file_path: 'a.ts' }, item: { detailRevision: 3 } });
  });

  it('distinguishes interrupted tools from failed results and does not reopen finished tools', () => {
    const t = new TurnTranscript('t1');
    const call = assistant([{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: 'a.ts' } }]);
    t.accept(call);
    expect(t.unfinishedTools('interrupted')).toMatchObject([{ id: 'tu1', status: 'interrupted', detailRevision: 1 }]);
    expect(t.accept(call)).toEqual([]);
    const failed = new TurnTranscript('t2');
    failed.accept(call);
    expect(toolChanges(failed.accept(result('permission denied', true)))[0]?.item.status).toBe('error');
    expect(failed.unfinishedTools('interrupted')).toEqual([]);
    expect(failed.accept(call)).toEqual([]);
  });

  it('summarises tools by their most telling input', () => {
    expect(summarizeTool('Grep', { pattern: 'foo', path: 'src' })).toBe('foo');
    expect(summarizeTool('Mystery', { a: 1 })).toBe('{"a":1}');
    expect(summarizeTool('X', undefined)).toBe('');
  });
});

describe('harnessEnv', () => {
  const hrc = { baseUrl: 'http://127.0.0.1:47322', accessKey: 'accio-hrc-key' };

  it('runs a thread only against its own profile, dropping any inherited login', () => {
    const env = harnessEnv(
      {
        PATH: '/bin',
        ANTHROPIC_API_KEY: 'personal-api-key',
        ANTHROPIC_BASE_URL: 'https://other',
        CLAUDE_CODE_OAUTH_TOKEN: 'oauth',
        CLAUDE_CONFIG_DIR: '/home/me/.claude',
        CLAUDE_CODE_USE_BEDROCK: '1',
        CLAUDECODE: '1',
        ELECTRON_RUN_AS_NODE: '1',
        CLAUDE_CODE_GIT_BASH_PATH: 'C:\\git\\bash.exe',
      },
      hrc,
      '/accio/profiles/hrc/claude',
    );
    expect(env).toEqual({
      PATH: '/bin',
      CLAUDE_CODE_GIT_BASH_PATH: 'C:\\git\\bash.exe',
      CLAUDE_CONFIG_DIR: '/accio/profiles/hrc/claude',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:47322',
      ANTHROPIC_AUTH_TOKEN: 'accio-hrc-key',
    });
  });
});
