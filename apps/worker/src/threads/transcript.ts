import { isDeepStrictEqual } from 'node:util';
import type { TranscriptItem } from '@accio/protocol';
import { shellCommandSummary } from '@accio/protocol';
import type { HarnessMessage, HarnessEvent, ContentBlock, StreamEvent } from './harness.js';

type ToolItem = Extract<TranscriptItem, { kind: 'tool' }>;

export type TranscriptChange =
  | { type: 'item'; item: TranscriptItem }
  /** Full tool data is materialized separately before publishing the compact item. */
  | { type: 'tool'; item: ToolItem; input: unknown; content?: unknown }
  | { type: 'delta'; itemId: string; text: string }
  | { type: 'session'; sessionId: string }
  | { type: 'end'; outcome: 'completed' | 'failed'; error?: string };

const OUTPUT_LIMIT = 4000;

type TextState = { kind: 'text'; id: string; text: string; finalText?: string };
type ToolState = {
  item: ToolItem;
  input: unknown;
  inputComplete: boolean;
  result?: { content: unknown; status: 'done' | 'error' };
};
type ToolBlock = { kind: 'tool'; toolId: string; inputJson: string };
type IgnoredBlock = { kind: 'ignored'; type: string };
type BlockState = TextState | ToolBlock | IgnoredBlock;
type AssistantEnvelope = { uuid?: string; content: ContentBlock[]; indices: number[] };
type MessageState = {
  blocks: Map<number, BlockState>;
  streamed: Set<number>;
  stopped: Set<number>;
  confirmed: Set<number>;
  envelopes: AssistantEnvelope[];
};

/**
 * Turns one turn's harness messages into transcript changes. Only the main harness
 * is shown; subagent messages (parent_tool_use_id set) are left out.
 *
 * Block indices preserve interleaved text/tool order and identity. The SDK emits
 * one assistant envelope per completed block, sharing message.id across envelopes.
 * Reconcile those fragments against their streamed blocks rather than array index 0.
 */
export class TurnTranscript {
  private currentMessageId = '';
  private messages = new Map<string, MessageState>();
  private tools = new Map<string, ToolState>();
  private assistantText = new Map<string, string>();
  private endResult?: string;
  private seq = 0;

  constructor(private turnId: string) {}

  private nextId(prefix: string) {
    return `${this.turnId}:${prefix}${this.seq++}`;
  }

  private message(id: string): MessageState {
    let state = this.messages.get(id);
    if (!state) {
      state = { blocks: new Map(), streamed: new Set(), stopped: new Set(), confirmed: new Set(), envelopes: [] };
      this.messages.set(id, state);
    }
    return state;
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
        const key = JSON.stringify([r.subtype, r.is_error, r.errors, r.result]);
        if (this.endResult === key) break;
        this.endResult = key;
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

  /** Tools still running when a turn stops early; cancellation is distinct from failure. */
  unfinishedTools(status: 'error' | 'interrupted' = 'error'): ToolItem[] {
    const unfinished: ToolItem[] = [];
    for (const tool of this.tools.values()) {
      if (tool.item.status !== 'running') continue;
      tool.item = { ...tool.item, status };
      unfinished.push(tool.item);
    }
    return unfinished;
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
    const previous = this.tools.get(id);
    const state: ToolState = {
      item: { ...previous?.item, kind: 'tool', id, turnId: this.turnId, name: event.name,
        summary: summarizeTool(event.name, event.name === 'Shell' || event.name === 'Bash' ? event.input ?? event.summary : event.summary), status: event.status,
        ...(event.output !== undefined ? { output: truncate(resultText(event.output)) } : {}) },
      input: event.input ?? event.summary,
      inputComplete: true,
      ...(event.status !== 'running' ? { result: { content: event.output, status: event.status } } : {}),
    };
    this.tools.set(id, state);
    const out: TranscriptChange[] = [];
    this.emitTool(state, out);
    return out;
  }

  private onStream(event: StreamEvent, out: TranscriptChange[]) {
    if (event.type === 'message_start') {
      const message = (event as { message: { id: string; usage?: unknown } }).message;
      this.currentMessageId = message.id;
      this.onUsage(message.id, message.usage, out);
      this.message(this.currentMessageId);
      return;
    }
    const e = event as { type: string; index?: number; content_block?: ContentBlock; delta?: { type: string; text?: string; partial_json?: string } };
    if (typeof e.index !== 'number') return;
    const message = this.message(this.currentMessageId);
    if (event.type === 'content_block_start') {
      const block = e.content_block;
      if (!block || message.blocks.has(e.index)) return;
      message.streamed.add(e.index);
      if (block.type === 'text') {
        const text = typeof block.text === 'string' ? block.text : '';
        const state: TextState = { kind: 'text', id: this.nextId('a'), text };
        message.blocks.set(e.index, state);
        out.push({ type: 'item', item: { kind: 'assistant', id: state.id, turnId: this.turnId, text } });
      } else if (block.type === 'tool_use') {
        const b = block as Extract<ContentBlock, { type: 'tool_use' }>;
        message.blocks.set(e.index, { kind: 'tool', toolId: b.id, inputJson: '' });
        this.upsertTool(b.id, b.name, b.input, false, out);
      } else {
        message.blocks.set(e.index, { kind: 'ignored', type: block.type });
      }
    } else if (event.type === 'content_block_delta') {
      const state = message.blocks.get(e.index);
      const delta = e.delta;
      if (state?.kind === 'text' && delta?.type === 'text_delta' && delta.text && state.finalText === undefined) {
        state.text += delta.text;
        out.push({ type: 'delta', itemId: state.id, text: delta.text });
      } else if (state?.kind === 'tool' && delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        state.inputJson += delta.partial_json;
      }
    } else if (event.type === 'content_block_stop') {
      message.stopped.add(e.index);
      const state = message.blocks.get(e.index);
      if (state?.kind !== 'tool') return;
      const tool = this.tools.get(state.toolId);
      if (!tool || tool.inputComplete) return;
      let input = tool.input;
      if (state.inputJson) {
        try {
          input = JSON.parse(state.inputJson);
        } catch {
          // Keep incomplete provider JSON visible in details; a final message can repair it.
          input = state.inputJson;
        }
      }
      this.upsertTool(tool.item.id, tool.item.name, input, true, out);
    }
  }

  private onAssistant(msg: Extract<HarnessMessage, { type: 'assistant' }>, out: TranscriptChange[]) {
    this.onUsage(msg.message.id, msg.message.usage, out);
    const message = this.message(msg.message.id);
    const content = msg.message.content;
    const previous = message.envelopes.find((envelope) => msg.uuid
      ? envelope.uuid === msg.uuid
      : !envelope.uuid && isDeepStrictEqual(envelope.content, content));
    if (previous && isDeepStrictEqual(previous.content, content)) {
      // SDK UUIDs identify envelopes, while message.id identifies the whole response.
      // Fakes without UUIDs can still confirm identical text in a later stream block.
      const pending = !msg.uuid && content.length === 1 ? this.fragmentIndex(message, content[0]!) : undefined;
      const state = pending === undefined ? undefined : message.blocks.get(pending);
      const first = content[0];
      const newIdenticalText = pending !== undefined && state?.kind === 'text' && first?.type === 'text'
        && state.text === first.text && !message.confirmed.has(pending) && !previous.indices.includes(pending);
      if (!newIdenticalText) return;
    }

    const indices = previous && msg.uuid ? previous.indices : content.length === 1
      ? [this.fragmentIndex(message, content[0]!) ?? this.nextBlockIndex(message)]
      : content.map((_block, index) => index);
    content.forEach((block, offset) => {
      const index = indices[offset] ?? offset;
      message.confirmed.add(index);
      if (block.type === 'text') {
        const text = (block as { text: string }).text;
        let state = message.blocks.get(index);
        if (state && state.kind !== 'text') return;
        if (!state) {
          if (!text.trim()) return;
          state = { kind: 'text', id: this.nextId('a'), text };
          message.blocks.set(index, state);
        }
        if (state.finalText === text) return;
        state.text = text;
        state.finalText = text;
        out.push({ type: 'item', item: { kind: 'assistant', id: state.id, turnId: this.turnId, text } });
      } else if (block.type === 'tool_use') {
        const b = block as { id: string; name: string; input: unknown };
        if (!message.blocks.has(index)) message.blocks.set(index, { kind: 'tool', toolId: b.id, inputJson: '' });
        this.upsertTool(b.id, b.name, b.input, true, out);
      } else if (!message.blocks.has(index)) {
        message.blocks.set(index, { kind: 'ignored', type: block.type });
      }
    });
    if (previous && msg.uuid) {
      previous.content = content;
      previous.indices = indices;
    } else {
      message.envelopes.push({ uuid: msg.uuid, content, indices });
    }
  }

  private nextBlockIndex(message: MessageState): number {
    return Math.max(-1, ...message.blocks.keys(), ...message.confirmed) + 1;
  }

  private usage = new Map<string, string>();

  private onUsage(messageId: string, raw: unknown, out: TranscriptChange[]) {
    if (!raw || typeof raw !== 'object') return;
    const value = raw as Record<string, unknown>;
    const count = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
    if (!count(value.input_tokens) || !count(value.cache_read_input_tokens) || !count(value.cache_creation_input_tokens)) return;
    const creation = value.cache_creation as Record<string, unknown> | undefined;
    const usage = {
      inputTokens: value.input_tokens, cacheReadTokens: value.cache_read_input_tokens,
      cacheWriteTokens: value.cache_creation_input_tokens,
      ...(count(creation?.ephemeral_1h_input_tokens) ? { cacheWrite1hTokens: creation.ephemeral_1h_input_tokens } : {}),
    };
    const key = JSON.stringify(usage);
    if (this.usage.get(messageId) === key) return;
    this.usage.set(messageId, key);
    // Stream starts and SDK content fragments share one response ID. Replace
    // its accounting rather than adding it again for every fragment.
    out.push({ type: 'item', item: { kind: 'usage', id: `${this.turnId}:usage:${messageId}`, turnId: this.turnId, provider: 'anthropic', usage } });
  }

  private fragmentIndex(message: MessageState, block: ContentBlock): number | undefined {
    if (block.type === 'tool_use') {
      for (const [index, state] of message.blocks) {
        if (state.kind === 'tool' && state.toolId === block.id) return index;
      }
    }
    const pending = [...message.streamed].filter((index) => {
      if (message.confirmed.has(index)) return false;
      const state = message.blocks.get(index);
      return state?.kind === 'text' ? block.type === 'text'
        : state?.kind === 'ignored' ? state.type === block.type : false;
    });
    const exactText = pending.find((index) => {
      const state = message.blocks.get(index);
      return block.type === 'text' && state?.kind === 'text' && state.text === block.text;
    });
    return pending.find((index) => message.stopped.has(index)) ?? exactText ?? pending[0];
  }

  private upsertTool(id: string, name: string, input: unknown, inputComplete: boolean, out: TranscriptChange[]) {
    let state = this.tools.get(id);
    if (state) {
      // Replayed starts cannot replace completed arguments or reopen a finished row.
      if (!inputComplete && state.inputComplete) return;
      if (state.item.name === name && state.inputComplete === inputComplete && isDeepStrictEqual(state.input, input)) return;
      state.input = input;
      state.inputComplete = inputComplete;
      state.item = { ...state.item, name, summary: summarizeTool(name, input) };
    } else {
      state = { item: { kind: 'tool', id, turnId: this.turnId, name, summary: summarizeTool(name, input), status: 'running' }, input, inputComplete };
      this.tools.set(id, state);
    }
    this.emitTool(state, out);
  }

  private emitTool(state: ToolState, out: TranscriptChange[]) {
    state.item = { ...state.item, detailRevision: (state.item.detailRevision ?? 0) + 1 };
    out.push({
      type: 'tool',
      item: state.item,
      input: state.input,
      ...(state.result ? { content: state.result.content } : {}),
    });
  }

  private onUser(msg: Extract<HarnessMessage, { type: 'user' }>, out: TranscriptChange[]) {
    if (typeof msg.message.content === 'string') return;
    for (const block of msg.message.content) {
      if (block.type !== 'tool_result') continue;
      const b = block as { tool_use_id: string; content?: unknown; is_error?: boolean };
      const tool = this.tools.get(b.tool_use_id);
      if (!tool) continue;
      const status = b.is_error ? 'error' : 'done';
      if (tool.result?.status === status && isDeepStrictEqual(tool.result.content, b.content)) continue;
      tool.result = { content: b.content, status };
      tool.item = { ...tool.item, status, output: truncate(resultText(b.content)) };
      this.emitTool(tool, out);
    }
  }
}

/** One line that says what a tool call does, for the collapsed row. */
export function summarizeTool(name: string, input: unknown): string {
  const i = input !== null && typeof input === 'object' ? input as Record<string, unknown> : {};
  const pick = (...keys: string[]) => keys.map((k) => i[k]).find((v) => typeof v === 'string' && v.length > 0) as string | undefined;
  const shell = name === 'Shell' || name === 'Bash';
  const description = shell && typeof i.description === 'string' ? i.description.trim() : '';
  const line =
    (description || undefined) ??
    pick('command', 'file_path', 'notebook_path', 'pattern', 'url', 'query', 'description', 'prompt', 'skill') ??
    (typeof input === 'string' ? input : Object.keys(i).length ? JSON.stringify(i) : '');
  const display = shell && !description ? shellCommandSummary(line) : line;
  const first = omitInlineData(display).split('\n')[0] ?? '';
  return first.length > 200 ? `${first.slice(0, 199)}…` : first;
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return omitInlineData(content);
  if (Array.isArray(content)) return content.map(resultText).join('\n');
  if (content === undefined || content === null) return '';
  if (typeof content !== 'object') return String(content);
  const block = content as Record<string, unknown>;
  if (block.type === 'text' && typeof block.text === 'string') return omitInlineData(block.text);
  if (block.type === 'image' || block.type === 'audio' || block.type === 'video') return `[${block.type}]`;
  if (block.type === 'resource_link' || block.type === 'file') {
    const name = typeof block.name === 'string' ? `: ${omitInlineData(block.name)}` : '';
    return `[file${name}]`;
  }
  return typeof block.type === 'string' ? `[Unsupported content: ${block.type}]` : '[Unsupported tool result: object]';
}

function omitInlineData(text: string): string {
  return text.replace(/data:[^\s;,]+(?:;[^\s;,]+)*;base64,[a-z\d+/_=-]+/gi, '[inline data omitted]');
}

function truncate(s: string): string {
  if (s.length <= OUTPUT_LIMIT) return s;
  const suffix = '\n… (preview truncated; expand for full output)';
  return `${s.slice(0, OUTPUT_LIMIT - suffix.length)}${suffix}`;
}
