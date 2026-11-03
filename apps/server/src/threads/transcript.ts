import type { TranscriptItem } from '@accio/protocol';
import type { HarnessMessage, HarnessEvent, ContentBlock, StreamEvent } from './harness.js';

export type TranscriptChange =
  | { type: 'item'; item: TranscriptItem }
  | { type: 'delta'; itemId: string; text: string }
  | { type: 'session'; sessionId: string }
  | { type: 'end'; outcome: 'completed' | 'failed'; error?: string };

const OUTPUT_LIMIT = 4000;

/**
 * Turns one turn's harness messages into transcript changes. Only the main harness
 * is shown; subagent messages (parent_tool_use_id set) are left out in v0.1.
 *
 * Text streams in as deltas and is then confirmed by the full assistant
 * message, which replaces the streamed item so the stored text is exact.
 */
export class TurnTranscript {
  private currentMessageId = '';
  /** Streamed text items per message id, in order, awaiting their final text. */
  private streamed = new Map<string, string[]>();
  private tools = new Map<string, Extract<TranscriptItem, { kind: 'tool' }>>();
  private assistantText = new Map<string, string>();
  private seq = 0;

  constructor(private turnId: string) {}

  private nextId(prefix: string) {
    return `${this.turnId}:${prefix}${this.seq++}`;
  }

  accept(msg: HarnessMessage): TranscriptChange[] {
    if (msg.type === 'harness_event') return this.onEvent(msg.event as HarnessEvent);
    const out: TranscriptChange[] = [];
    if (msg.type === 'system' && msg.subtype === 'init' && typeof msg.session_id === 'string') {
      out.push({ type: 'session', sessionId: msg.session_id });
    }
    if ('parent_tool_use_id' in msg && msg.parent_tool_use_id) return out;

    switch (msg.type) {
      case 'stream_event':
        this.onStream((msg as Extract<HarnessMessage, { type: 'stream_event' }>).event, out);
        break;
      case 'assistant':
        this.onAssistant(msg as Extract<HarnessMessage, { type: 'assistant' }>, out);
        break;
      case 'user':
        this.onUser(msg as Extract<HarnessMessage, { type: 'user' }>, out);
        break;
      case 'result': {
        const r = msg as Extract<HarnessMessage, { type: 'result' }>;
        if (r.is_error || r.subtype !== 'success') {
          const error = r.errors?.join('\n') || r.result || `Turn ended with ${r.subtype}`;
          out.push({ type: 'item', item: { kind: 'notice', id: this.nextId('n'), turnId: this.turnId, tone: 'error', text: error } });
          out.push({ type: 'end', outcome: 'failed', error });
        } else {
          out.push({ type: 'end', outcome: 'completed' });
        }
        break;
      }
    }
    return out;
  }

  private onEvent(event: HarnessEvent): TranscriptChange[] {
    if (event.kind === 'session') return [{ type: 'session', sessionId: event.id }];
    if (event.kind === 'end') return event.error ? [
      { type: 'item', item: { kind: 'notice', id: this.nextId('n'), turnId: this.turnId, tone: 'error', text: event.error } },
      { type: 'end', outcome: 'failed', error: event.error },
    ] : [{ type: 'end', outcome: 'completed' }];
    const id = `${this.turnId}:${event.id}`;
    if (event.kind === 'text') {
      const previous = this.assistantText.get(id);
      const text = event.append ? (previous ?? '') + event.text : event.text;
      this.assistantText.set(id, text);
      return event.append && previous !== undefined ? [{ type: 'delta', itemId: id, text: event.text }]
        : [{ type: 'item', item: { kind: 'assistant', id, turnId: this.turnId, text } }];
    }
    const item = { kind: 'tool' as const, id, turnId: this.turnId, name: event.name, summary: event.summary.slice(0, 200), status: event.status,
      ...(event.output !== undefined ? { output: truncate(event.output) } : {}) };
    this.tools.set(id, item);
    return [{ type: 'item', item }];
  }

  /** Tools still marked running when a turn stops early. */
  unfinishedTools(): TranscriptItem[] {
    return [...this.tools.values()].filter((t) => t.status === 'running').map((t) => ({ ...t, status: 'error' as const }));
  }

  private onStream(event: StreamEvent, out: TranscriptChange[]) {
    if (event.type === 'message_start') {
      this.currentMessageId = (event as { message: { id: string } }).message.id;
    } else if (event.type === 'content_block_start') {
      const block = (event as { content_block: { type: string } }).content_block;
      if (block.type !== 'text') return;
      const id = this.nextId('a');
      const list = this.streamed.get(this.currentMessageId) ?? [];
      list.push(id);
      this.streamed.set(this.currentMessageId, list);
      this.assistantText.set(id, '');
      out.push({ type: 'item', item: { kind: 'assistant', id, turnId: this.turnId, text: '' } });
    } else if (event.type === 'content_block_delta') {
      const delta = (event as { delta: { type: string; text?: string } }).delta;
      if (delta.type !== 'text_delta' || !delta.text) return;
      const id = this.streamed.get(this.currentMessageId)?.at(-1);
      if (!id) return;
      this.assistantText.set(id, (this.assistantText.get(id) ?? '') + delta.text);
      out.push({ type: 'delta', itemId: id, text: delta.text });
    }
  }

  private onAssistant(msg: Extract<HarnessMessage, { type: 'assistant' }>, out: TranscriptChange[]) {
    for (const block of msg.message.content) {
      if (block.type === 'text') {
        const text = (block as { text: string }).text;
        const pending = this.streamed.get(msg.message.id);
        const id = pending?.shift() ?? this.nextId('a');
        if (!text.trim() && !this.assistantText.get(id)) continue;
        out.push({ type: 'item', item: { kind: 'assistant', id, turnId: this.turnId, text } });
      } else if (block.type === 'tool_use') {
        const b = block as { id: string; name: string; input: unknown };
        const item = {
          kind: 'tool' as const,
          id: b.id,
          turnId: this.turnId,
          name: b.name,
          summary: summarizeTool(b.name, b.input),
          status: 'running' as const,
        };
        this.tools.set(b.id, item);
        out.push({ type: 'item', item });
      }
    }
  }

  private onUser(msg: Extract<HarnessMessage, { type: 'user' }>, out: TranscriptChange[]) {
    if (typeof msg.message.content === 'string') return;
    for (const block of msg.message.content) {
      if (block.type !== 'tool_result') continue;
      const b = block as { tool_use_id: string; content?: unknown; is_error?: boolean };
      const tool = this.tools.get(b.tool_use_id);
      if (!tool) continue;
      const done = { ...tool, status: b.is_error ? ('error' as const) : ('done' as const), output: truncate(resultText(b.content)) };
      this.tools.set(tool.id, done);
      out.push({ type: 'item', item: done });
    }
  }
}

/** One line that says what a tool call does, for the collapsed row. */
export function summarizeTool(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]) => keys.map((k) => i[k]).find((v) => typeof v === 'string' && v.length > 0) as string | undefined;
  const line =
    pick('command', 'file_path', 'notebook_path', 'pattern', 'url', 'query', 'description', 'prompt', 'skill') ??
    (Object.keys(i).length ? JSON.stringify(i) : '');
  const first = line.split('\n')[0] ?? '';
  return first.length > 200 ? `${first.slice(0, 199)}…` : first;
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c: ContentBlock) => (c.type === 'text' ? (c as { text: string }).text : `[${c.type}]`)).join('\n');
  }
  return content === undefined ? '' : JSON.stringify(content);
}

function truncate(s: string): string {
  return s.length > OUTPUT_LIMIT ? `${s.slice(0, OUTPUT_LIMIT)}\n… (${s.length - OUTPUT_LIMIT} more characters)` : s;
}
