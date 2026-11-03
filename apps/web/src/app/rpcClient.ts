import type { EventName, Events, MethodName, ParamsOf, ResultOf, ServerEnvelope } from '@accio/protocol';

export type ConnectionStatus = 'connecting' | 'open' | 'closed' | 'unauthorized';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

/**
 * One WebSocket to one machine's server. Reconnects on its own; listeners
 * survive reconnects.
 */
export class RpcClient {
  private ws?: WebSocket;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private eventListeners = new Map<string, Set<(data: unknown) => void>>();
  private statusListeners = new Set<(s: ConnectionStatus) => void>();
  private retry?: ReturnType<typeof setTimeout>;
  private closed = false;
  status: ConnectionStatus = 'connecting';

  constructor(private url: string) {
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
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }

  private connect() {
    this.setStatus('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      this.setStatus('open');
    };
    ws.onmessage = (e) => this.receive(JSON.parse(String(e.data)) as ServerEnvelope);
    ws.onclose = () => {
      for (const p of this.pending.values()) p.reject(new Error('Connection lost'));
      this.pending.clear();
      // A refused upgrade never opens; most likely a wrong token.
      if (this.closed) return;
      this.setStatus(opened ? 'closed' : 'unauthorized');
      this.retry = setTimeout(() => this.connect(), opened ? 500 : 3000);
    };
  }

  private receive(msg: ServerEnvelope) {
    if (msg.type === 'response') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error));
    } else {
      for (const l of this.eventListeners.get(msg.event) ?? []) l(msg.data);
    }
  }

  call<M extends MethodName>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Not connected'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
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
