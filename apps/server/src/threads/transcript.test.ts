import { describe, expect, it } from 'vitest';
import type { AgentMessage } from './agent.js';
import { agentEnv } from './agentEnv.js';
import { summarizeTool, TurnTranscript } from './transcript.js';

const S = 'sess-1';
const stream = (event: object): AgentMessage => ({ type: 'stream_event', event, parent_tool_use_id: null, session_id: S }) as AgentMessage;

describe('TurnTranscript', () => {
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
    ].flatMap((m) => t.accept(m as AgentMessage));

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
    ].flatMap((m) => t.accept(m as AgentMessage));

    expect(changes).toEqual([
      { type: 'item', item: { kind: 'tool', id: 'tu1', turnId: 't1', name: 'Bash', summary: 'ls -la', status: 'running' } },
      {
        type: 'item',
        item: { kind: 'tool', id: 'tu1', turnId: 't1', name: 'Bash', summary: 'ls -la', status: 'done', output: 'file.txt' },
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
    } as AgentMessage);
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
    } as AgentMessage);
    expect(t.unfinishedTools()).toEqual([{ kind: 'tool', id: 'tu1', turnId: 't1', name: 'Read', summary: 'a.ts', status: 'error' }]);
  });

  it('summarises tools by their most telling input', () => {
    expect(summarizeTool('Grep', { pattern: 'foo', path: 'src' })).toBe('foo');
    expect(summarizeTool('Mystery', { a: 1 })).toBe('{"a":1}');
    expect(summarizeTool('X', undefined)).toBe('');
  });
});

describe('agentEnv', () => {
  const hrc = { baseUrl: 'http://127.0.0.1:47322', accessKey: 'accio-hrc-key' };

  it('runs a thread only against its own profile, dropping any inherited login', () => {
    const env = agentEnv(
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
