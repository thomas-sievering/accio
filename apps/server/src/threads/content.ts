import { createHash } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import { rm } from 'node:fs/promises';
import { JsonFile } from '@accio/persistence';
import type { MediaBinding, ResultPart, ToolDetails } from '@accio/protocol';
import type { ThreadAssets } from './assets.js';
import { markdownReferences } from './markdown.js';

/** Details remain available on demand while routine transcript events stay small. */
export const MAX_DETAIL_CHARACTERS = 1_000_000;
const MAX_INPUT_CHARACTERS = 100_000;
const MAX_RESULT_PARTS = 64;

export class ThreadContent {
  constructor(private home: string, readonly assets: ThreadAssets) {}

  private detailFile(threadId: string, itemId: string) {
    const id = createHash('sha256').update(itemId).digest('hex');
    return new JsonFile<ToolDetails | null>(join(this.home, 'thread-details', threadId, `${id}.json`), () => null);
  }

  details(threadId: string, itemId: string) { return this.detailFile(threadId, itemId).read(); }

  async saveTool(threadId: string, itemId: string, input: unknown, content?: unknown): Promise<void> {
    let truncated = false;
    const encoded = JSON.stringify(input ?? null) ?? 'null';
    const storedInput = encoded.length <= MAX_INPUT_CHARACTERS ? input ?? null : `${encoded.slice(0, MAX_INPUT_CHARACTERS)}\n… input limit reached`;
    if (encoded.length > MAX_INPUT_CHARACTERS) truncated = true;
    const previous = content === undefined ? await this.details(threadId, itemId) : null;
    const parts: ResultPart[] = previous?.parts ?? [];
    let remaining = MAX_DETAIL_CHARACTERS;
    const addText = (text: string) => {
      if (parts.length >= MAX_RESULT_PARTS || remaining <= 0) { truncated = true; return; }
      if (text.length > remaining) truncated = true;
      const kept = text.slice(0, remaining);
      remaining -= kept.length;
      parts.push({ type: 'text', text: kept });
    };
    const unsupported = (label: string) => {
      if (parts.length < MAX_RESULT_PARTS) parts.push({ type: 'unsupported', label });
      else truncated = true;
    };
    const accept = async (value: unknown, depth = 0): Promise<void> => {
      if (depth > 8 || parts.length >= MAX_RESULT_PARTS) { truncated = true; return; }
      if (typeof value === 'string') { addText(value); return; }
      if (Array.isArray(value)) { for (const block of value) await accept(block, depth + 1); return; }
      if (value === null || value === undefined) return;
      if (typeof value !== 'object') { addText(String(value)); return; }
      const block = value as Record<string, unknown>;
      if (block.type === 'text' && typeof block.text === 'string') { addText(block.text); return; }
      if (Array.isArray(block.content)) { await accept(block.content, depth + 1); return; }
      if (block.type === 'image' || block.type === 'audio' || block.type === 'video' || block.type === 'resource') {
        const candidate = block.source ?? block.resource ?? block;
        const source = candidate && typeof candidate === 'object' ? candidate as Record<string, unknown> : {};
        const data = source.data ?? source.blob;
        const mimeType = source.media_type ?? source.mimeType ?? block.mimeType;
        if (typeof data === 'string' && typeof mimeType === 'string') {
          // Base64 never enters the transcript or the separately fetched text details.
          const mediaLimit = mimeType.startsWith('image/') ? 10 * 1024 * 1024 : 100 * 1024 * 1024;
          if (data.length > Math.ceil(mediaLimit / 3) * 4 || !/^[a-z\d+/]*={0,2}$/i.test(data) || data.length % 4 === 1) {
            unsupported('Invalid or oversized tool media.'); return;
          }
          try {
            const asset = await this.assets.importMedia(threadId, Buffer.from(data, 'base64'), mimeType);
            parts.push({ type: 'media', asset });
          } catch (error) { unsupported(error instanceof Error ? error.message : 'Tool media unavailable.'); }
          return;
        }
        unsupported(`Unsupported ${String(block.type)} result: embedded media data is unavailable.`);
        return;
      }
      if (typeof block.type === 'string') { unsupported(`Unsupported tool result: ${block.type}.`); return; }
      addText(JSON.stringify(block, null, 2));
    };
    if (content !== undefined) await accept(content);
    await this.detailFile(threadId, itemId).write({ input: storedInput, parts, ...((truncated || previous?.truncated) ? { truncated: true } : {}) });
  }

  async snapshotMarkdown(threadId: string, cwd: string, text: string, previous: readonly MediaBinding[] = []): Promise<MediaBinding[]> {
    const sources = markdownReferences(text).media;
    const bindings: MediaBinding[] = [];
    for (const source of sources.slice(0, MAX_RESULT_PARTS)) {
      const saved = previous.find((binding) => binding.source === source);
      bindings.push(saved ?? await this.assets.snapshot(threadId, cwd, source));
    }
    for (const source of sources.slice(MAX_RESULT_PARTS)) bindings.push({ source, error: 'Too many media embeds in one message.' });
    return bindings;
  }

  async delete(threadId: string) {
    const base = resolve(this.home, 'thread-details');
    const target = resolve(base, threadId);
    if (!target.startsWith(base + sep) || target === base) throw new Error('Invalid thread content directory');
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 30 });
    await this.assets.delete(threadId);
  }
}
