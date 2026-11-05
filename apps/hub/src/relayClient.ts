import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { RelayFrame, RelayHubFrame } from '@accio/protocol';
import { RELAY_FRAME_BYTES } from './service.js';
import { keepAlive } from './keepAlive.js';

/** Frames above this are sent as chunks; leaves room for the envelope. */
const CHUNK_CHARS = 256 * 1024;
/** A reassembled frame may not exceed this. */
const MAX_FRAME_CHARS = 64 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 60_000;

export type RelayRequest = { from: string; method: string; params: unknown };
export type RelayHandlers = {
  /** Serves another machine's request; throw to answer with an error. */
  request(request: RelayRequest): Promise<unknown>;
  event(from: string, event: string, data: unknown): void;
  /** The machines connected to the relay right now, this one included. */
  peers(machines: string[]): void;
  /** This machine's relay socket closed; every peer counts as unreachable until it reopens. */
  disconnected(): void;
};

type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };

/**
 * GLOSSARY: Relay. This machine's socket to the hub's relay. The hub forwards each
 * frame to the machine named in `to`; nothing is stored there, so a dropped socket
 * loses in-flight frames and the owner resends whole state when it reconnects.
 */
export class RelaySocket {
  private ws?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private pending = new Map<string, Pending>();
  private parts = new Map<string, { total: number; chunks: string[]; received: number; size: number }>();
  private attempts = 0;
  open = false;

  constructor(private url: string, private token: string, private handlers: RelayHandlers) {}

  start() { this.connect(); }

  call(to: string, method: string, params: unknown): Promise<unknown> {
    if (!this.open) return Promise.reject(new Error('This machine is not connected to the hub relay.'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('The other machine did not answer in time.')); }, REQUEST_TIMEOUT_MS);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.send({ kind: 'request', to, id, method, params });
    });
  }

  emit(to: string, event: string, data: unknown) { if (this.open) this.send({ kind: 'event', to, event, data }); }

  private send(frame: RelayFrame) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const text = JSON.stringify(frame);
    if (text.length <= CHUNK_CHARS) { ws.send(text); return; }
    const id = frame.kind === 'request' ? frame.id : randomUUID();
    const total = Math.ceil(text.length / CHUNK_CHARS);
    for (let index = 0; index < total; index++) {
      ws.send(JSON.stringify({ kind: 'chunk', to: frame.to, id, index, total, data: text.slice(index * CHUNK_CHARS, (index + 1) * CHUNK_CHARS) } satisfies RelayFrame));
    }
  }

  private connect() {
    if (this.stopped) return;
    const url = new URL('/relay', this.url); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url, { headers: { authorization: `Bearer ${this.token}` }, handshakeTimeout: 10_000, maxPayload: RELAY_FRAME_BYTES });
    this.ws = ws;
    ws.on('open', () => { this.open = true; this.attempts = 0; keepAlive(ws); });
    ws.on('message', (data, binary) => { if (!binary && this.ws === ws) this.receive(String(data)); });
    ws.on('error', () => {});
    ws.on('close', () => {
      if (this.ws !== ws) return;
      const wasOpen = this.open;
      this.open = false; this.parts.clear();
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('The hub relay connection was lost.')); }
      this.pending.clear();
      if (wasOpen) this.handlers.disconnected();
      this.schedule();
    });
  }

  /** Jittered backoff: a restarted hub must not see every machine reconnect in the same second. */
  private schedule() {
    if (this.stopped || this.retry) return;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.attempts++, 5)) * (0.5 + Math.random() / 2);
    this.retry = setTimeout(() => { this.retry = undefined; this.connect(); }, delay);
    this.retry.unref?.();
  }

  private receive(text: string) {
    let frame: (RelayFrame | RelayHubFrame) & { from?: string };
    try { frame = JSON.parse(text); } catch { return; }
    if (!frame || typeof frame !== 'object') return;
    switch (frame.kind) {
      case 'peers': if (frame.from === 'hub' && Array.isArray(frame.machines)) this.handlers.peers(frame.machines.filter((m) => typeof m === 'string')); return;
      case 'undeliverable': {
        if (frame.from !== 'hub') return;
        const p = this.pending.get(frame.id);
        if (p) { this.pending.delete(frame.id); clearTimeout(p.timer); p.reject(new Error('The other machine is offline.')); }
        return;
      }
      case 'chunk': return this.chunk(frame);
      case 'request': {
        if (typeof frame.from !== 'string' || typeof frame.method !== 'string' || typeof frame.id !== 'string') return;
        const { from, id } = frame;
        void this.handlers.request({ from, method: frame.method, params: frame.params }).then(
          (result) => this.send({ kind: 'response', to: from, id, ok: true, result: result ?? null }),
          (error: unknown) => this.send({ kind: 'response', to: from, id, ok: false, error: error instanceof Error ? error.message : String(error) }));
        return;
      }
      case 'response': {
        const p = this.pending.get(frame.id);
        if (!p) return;
        this.pending.delete(frame.id); clearTimeout(p.timer);
        if (frame.ok) p.resolve(frame.result); else p.reject(new Error(frame.error));
        return;
      }
      case 'event': if (typeof frame.from === 'string' && typeof frame.event === 'string') this.handlers.event(frame.from, frame.event, frame.data); return;
    }
  }

  private chunk(frame: Extract<RelayFrame, { kind: 'chunk' }>) {
    const key = `${frame.from}:${frame.id}`;
    if (!Number.isInteger(frame.total) || frame.total < 1 || !Number.isInteger(frame.index) || frame.index < 0 || frame.index >= frame.total || typeof frame.data !== 'string') return;
    const entry = this.parts.get(key) ?? { total: frame.total, chunks: [], received: 0, size: 0 };
    if (entry.total !== frame.total || entry.chunks[frame.index] !== undefined) return;
    entry.chunks[frame.index] = frame.data; entry.received++; entry.size += frame.data.length;
    if (entry.size > MAX_FRAME_CHARS) { this.parts.delete(key); return; }
    this.parts.set(key, entry);
    if (entry.received < entry.total) return;
    this.parts.delete(key);
    // Parts of one frame arrive in order over one socket, so the joined text is the original frame; `from` is restamped by the hub.
    let whole: any;
    try { whole = JSON.parse(entry.chunks.join('')); } catch { return; }
    if (whole && typeof whole === 'object' && ['request', 'response', 'event'].includes(whole.kind)) this.receive(JSON.stringify({ ...whole, from: frame.from }));
  }

  close() {
    this.stopped = true; clearTimeout(this.retry);
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('The hub relay connection was closed.')); }
    this.pending.clear();
    this.ws?.terminate();
  }
}
