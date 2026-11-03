import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import type { EventName, Events, MethodName, ParamsOf, ResultOf, ServerEnvelope } from '@accio/protocol';
import { startApp, type AppDeps } from '../app.js';

export const TEST_TOKEN = 'test-token';

/** A real server on a random port with a throwaway ACCIO_HOME, plus a client. */
/** Pass an existing `home` to simulate a restart on the same machine. */
export async function startTestApp(deps: Partial<AppDeps> = {}, existingHome?: string) {
  const home = existingHome ?? (await mkdtemp(join(tmpdir(), 'accio-test-')));
  const app = await startApp({ home, host: '127.0.0.1', port: 0, token: TEST_TOKEN }, deps);
  const clients: TestClient[] = [];
  return {
    home,
    app,
    url: `ws://127.0.0.1:${app.port}/ws`,
    async connect(token = TEST_TOKEN) {
      const c = await TestClient.open(`ws://127.0.0.1:${app.port}/ws?token=${token}`);
      clients.push(c);
      return c;
    },
    async stop({ keepHome = false } = {}) {
      for (const c of clients) c.close();
      await app.close();
      if (keepHome) return;
      // Windows may still hold a just-written file for a moment.
      await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    },
  };
}

export class TestClient {
  private nextId = 1;
  private pending = new Map<number, (m: ServerEnvelope) => void>();
  readonly events: { event: string; data: unknown }[] = [];
  private waiters: (() => void)[] = [];

  private constructor(private ws: WebSocket) {
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as ServerEnvelope;
      if (msg.type === 'response') this.pending.get(msg.id)?.(msg);
      else {
        this.events.push(msg);
        for (const w of this.waiters.splice(0)) w();
      }
    });
  }

  static open(url: string): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.once('open', () => resolve(new TestClient(ws)));
      ws.once('error', reject);
    });
  }

  async call<M extends MethodName>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> {
    const id = this.nextId++;
    const msg = await new Promise<ServerEnvelope>((resolve) => {
      this.pending.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
    if (msg.type !== 'response') throw new Error('unexpected');
    if (!msg.ok) throw new Error(msg.error);
    return msg.result as ResultOf<M>;
  }

  /** Waits until an event matching `pred` has arrived (including earlier ones). */
  async waitFor<E extends EventName>(event: E, pred: (data: Events[E]) => boolean = () => true, timeoutMs = 5000): Promise<Events[E]> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const hit = this.events.find((e) => e.event === event && pred(e.data as Events[E]));
      if (hit) return hit.data as Events[E];
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${event}`);
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, 50);
      });
    }
  }

  close() {
    this.ws.close();
  }
}
