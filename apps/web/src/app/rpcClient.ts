import type { EventName, Events, MethodName, ParamsOf, ResultOf, ServerEnvelope } from '@accio/protocol';

/** `unreachable`: the worker did not answer. `unauthorized`: it answered and refused the token. */
export type ConnectionStatus = 'connecting' | 'open' | 'closed' | 'unreachable' | 'unauthorized';

export type AppClient = Pick<RpcClient, 'hubId' | 'status' | 'call' | 'onEvent' | 'onStatus' | 'httpUrl' | 'close'> & { readonly browser?: boolean };

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

/** The part of a browser WebSocket the client uses, so tests can drive a fake one. */
export type SocketLike = {
  readonly readyState: number;
  onopen: ((e: unknown) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: unknown) => void) | null;
  send(data: string): void;
  close(): void;
};

export type RpcClientOptions = {
  socket?: (url: string) => SocketLike;
  /** Asks the worker over HTTP why a connection never opened. */
  probe?: (url: string) => Promise<'unreachable' | 'unauthorized'>;
  callTimeoutMs?: number;
};

const OPEN = 1;
const CALL_TIMEOUT_MS = 60_000;
const RETRY_MIN_MS = 500;
const RETRY_MAX_MS = 30_000;

/** A plain GET to the socket path answers 401 when the token is wrong; no answer means the worker is down. */
async function probeWorker(url: string): Promise<'unreachable' | 'unauthorized'> {
  const http = new URL(url);
  http.protocol = http.protocol === 'wss:' ? 'https:' : 'http:';
  try {
    const res = await fetch(http, { cache: 'no-store' });
    return res.status === 401 ? 'unauthorized' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}

function envelope(raw: unknown): ServerEnvelope | undefined {
  let msg: any;
  try { msg = JSON.parse(String(raw)); } catch { return undefined; }
  if (msg?.type === 'response' && typeof msg.id === 'number' && (msg.ok === true || typeof msg.error === 'string')) return msg;
  if (msg?.type === 'event' && typeof msg.event === 'string') return msg;
  return undefined;
}

/**
 * One WebSocket to one machine's server. Reconnects on its own, backing off
 * while it keeps failing; listeners survive reconnects.
 */
export class RpcClient {
  private ws?: SocketLike;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private eventListeners = new Map<string, Set<(data: unknown) => void>>();
  private statusListeners = new Set<(s: ConnectionStatus) => void>();
  private retry?: ReturnType<typeof setTimeout>;
  private retryDelay = RETRY_MIN_MS;
  private closed = false;
  private socket: (url: string) => SocketLike;
  private probe: (url: string) => Promise<'unreachable' | 'unauthorized'>;
  private callTimeoutMs: number;
  status: ConnectionStatus = 'connecting';

  constructor(private url: string, options: RpcClientOptions = {}) {
    this.socket = options.socket ?? ((u) => new WebSocket(u) as unknown as SocketLike);
    this.probe = options.probe ?? probeWorker;
    this.callTimeoutMs = options.callTimeoutMs ?? CALL_TIMEOUT_MS;
    this.connect();
  }
  get hubId() { return new URL(this.url).searchParams.get('hub') ?? ''; }

  /** Asset grants belong to the machine connection, never the renderer's filesystem. */
  httpUrl(path: string): string {
    const base = new URL(this.url);
    base.protocol = base.protocol === 'wss:' ? 'https:' : 'http:';
    base.pathname = '/';
    base.search = '';
    return new URL(this.hubId && path.startsWith('/thread-assets/') ? `/hubs/${this.hubId}${path}` : path, base).href;
  }

  private setStatus(s: ConnectionStatus) {
    if (this.status === s) return;
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }

  /** Keeps showing the last failure while retrying, so the notice does not flicker. */
  private connect() {
    const ws = this.socket(this.url);
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      this.retryDelay = RETRY_MIN_MS;
      this.setStatus('open');
    };
    ws.onmessage = (e) => {
      const msg = envelope(e.data);
      if (msg) this.receive(msg);
      else console.warn('Dropped a malformed message from the worker', e.data);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.failPending('Connection lost');
      if (this.closed) return;
      if (opened) {
        this.setStatus('closed');
        this.scheduleRetry();
        return;
      }
      void this.probe(this.url).then((reason) => {
        if (this.closed || this.ws !== ws) return;
        this.setStatus(reason);
        this.scheduleRetry();
      });
    };
  }

  private scheduleRetry() {
    const delay = this.retryDelay;
    this.retryDelay = Math.min(delay * 2, RETRY_MAX_MS);
    this.retry = setTimeout(() => this.connect(), delay);
  }

  private failPending(message: string) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(message)); }
    this.pending.clear();
  }

  private receive(msg: ServerEnvelope) {
    if (msg.type === 'response') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error));
    } else {
      for (const l of this.eventListeners.get(msg.event) ?? []) l(msg.data);
    }
  }

  call<M extends MethodName>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> {
    const ws = this.ws;
    if (!ws || ws.readyState !== OPEN) return Promise.reject(new Error('Not connected'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new Error('The worker did not answer in time'));
      }, this.callTimeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  onEvent<E extends EventName>(event: E, listener: (data: Events[E]) => void): () => void {
    const set = this.eventListeners.get(event) ?? new Set();
    set.add(listener as (d: unknown) => void);
    this.eventListeners.set(event, set);
    return () => set.delete(listener as (d: unknown) => void);
  }

  onStatus(listener: (s: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  close() {
    this.closed = true;
    clearTimeout(this.retry);
    this.failPending('Connection closed');
    this.ws?.close();
  }
}

/**
 * The token arrives once in the URL hash (from the desktop app or the server's
 * startup line), then lives in sessionStorage so it leaves the address bar.
 */
export function takeToken(): string | null {
  const hash = new URLSearchParams(location.hash.slice(1));
  const fromHash = hash.get('token');
  if (fromHash) {
    sessionStorage.setItem('accio.token', fromHash);
    history.replaceState(null, '', location.pathname + location.search);
    return fromHash;
  }
  return sessionStorage.getItem('accio.token');
}

export function socketUrl(token: string, hubId?: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws?token=${encodeURIComponent(token)}${hubId ? `&hub=${encodeURIComponent(hubId)}` : ''}`;
}
