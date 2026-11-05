import type WebSocket from 'ws';

const INTERVAL_MS = 15_000;

/**
 * Ends a machine's socket to the hub once the hub stops answering, so its close
 * handler reconnects. After this machine sleeps, the hub has already dropped the
 * socket but this side never heard: without this it waits on a dead socket forever.
 * A tick that comes far too late means the machine just woke, so it reconnects at once.
 * Call once the socket is open.
 */
export function keepAlive(ws: WebSocket, intervalMs = INTERVAL_MS) {
  let alive = true;
  let last = Date.now();
  const mark = () => { alive = true; };
  ws.on('pong', mark); ws.on('ping', mark); ws.on('message', mark);
  const timer = setInterval(() => {
    const now = Date.now();
    const woke = now - last > intervalMs * 2;
    last = now;
    if (!alive || woke) { clearInterval(timer); ws.terminate(); return; }
    alive = false;
    ws.ping();
  }, intervalMs);
  timer.unref?.();
  ws.once('close', () => clearInterval(timer));
}
