import WebSocket from 'ws';
import type { EventEnvelope, ServerEnvelope } from '@accio/protocol';

/** One bounded connection; never reconnect and accidentally repeat a write. */
export class CliClient {
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private events: EventEnvelope[] = [];
  private eventListener?: (event: EventEnvelope) => void;
  set onEvent(listener: (event: EventEnvelope) => void) {
    this.eventListener = listener;
    for (const event of this.events.splice(0)) listener(event);
  }
  onClose: (error: Error) => void = () => {};

  private constructor(private ws: WebSocket, private timeout: number) {
    ws.on('message', (raw) => {
      let message: ServerEnvelope;
      try { message = JSON.parse(String(raw)); }
      catch { this.fail(new Error('Worker sent invalid JSON')); return; }
      if (message.type === 'event') {
        if (this.eventListener) this.eventListener(message);
        else if (this.events.length < 1000) this.events.push(message);
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error));
    });
    ws.on('error', () => this.fail(new Error('Worker connection failed')));
    ws.on('close', () => this.fail(new Error('Worker connection closed')));
  }

  static async open(url: URL, timeout: number): Promise<CliClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { handshakeTimeout: timeout });
      const client = new CliClient(ws, timeout);
      ws.once('open', () => resolve(client));
      // Do not print ws errors: they can contain the credential-bearing URL.
      ws.once('error', () => reject(new Error('Cannot connect to worker. Check its address, token, and that it is running.')));
    });
  }

  call(method: string, params: unknown): Promise<unknown> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}; a write may still have completed. Check state before retrying.`));
      }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }), (error) => {
        if (error) this.fail(new Error('Could not send request to worker'));
      });
    });
  }

  private fail(error: Error) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    this.onClose(error);
  }

  close() { this.ws.terminate(); }
}
