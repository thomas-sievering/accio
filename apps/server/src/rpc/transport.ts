import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { EventEnvelope } from '@accio/protocol';
import type { Router, Broadcast } from './router.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

export function tokenMatches(expected: string, given: string | null): boolean {
  if (!given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type TransportOptions = {
  host: string;
  port: number;
  token: string;
  router: Router;
  /** Built web client to serve; omitted in dev, where Vite serves it. */
  webRoot?: string;
  serveAsset?: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
};

/**
 * HTTP serves the static client; everything else goes over WebSocket. Every
 * WebSocket must present the machine's token (ADR 0001: no anonymous access).
 */
export async function startTransport(opts: TransportOptions) {
  const http = createServer((req, res) => {
    void (async () => {
      if (opts.serveAsset && await opts.serveAsset(req, res)) return;
      await serveStatic(opts.webRoot, req, res);
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' }).end('Content unavailable');
      else res.destroy();
    });
  });
  const wss = new WebSocketServer({ noServer: true });

  http.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws' || !tokenMatches(opts.token, url.searchParams.get('token'))) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on('message', async (data) => {
        let raw: unknown;
        try {
          raw = JSON.parse(String(data));
        } catch {
          return;
        }
        const response = await opts.router.handle(raw);
        if (response && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(response));
      });
    });
  });

  const broadcast: Broadcast = (event, data) => {
    const msg = JSON.stringify({ type: 'event', event, data } satisfies EventEnvelope);
    for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(msg);
  };

  await new Promise<void>((done, fail) => {
    http.once('error', fail);
    http.listen(opts.port, opts.host, () => done());
  });
  const address = http.address();
  const port = typeof address === 'object' && address ? address.port : opts.port;

  return {
    port,
    broadcast,
    close: () =>
      new Promise<void>((done) => {
        for (const client of wss.clients) client.terminate();
        http.close(() => done());
      }),
  };
}

async function serveStatic(root: string | undefined, req: IncomingMessage, res: ServerResponse) {
  if (!root) {
    res.writeHead(404).end('accio server (no web client built)');
    return;
  }
  const base = resolve(root);
  const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  let file = normalize(join(base, pathname));
  if (file !== base && !file.startsWith(base + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(base, 'index.html'); // single-page app fallback
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}
