import type WebSocket from 'ws';

const MACHINE_INTERVAL_MS = 15_000;
/** How often the hub pings its machines' sockets; one that missed the last ping is closed. */
export const HUB_INTERVAL_MS = 25_000;

/**
 * Ends a socket once the other side stops answering, so its close handler runs.
 * Pings every interval and closes the socket if nothing came back since the last ping.
 *
 * A machine keeps its socket to the hub alive with `endOnWake`: after the machine
 * sleeps, the hub has already dropped the socket but this side never heard, so a
 * tick that comes far too late means the machine just woke and it reconnects at once.
 * The hub keeps its relay and events sockets alive without it.
 * Call once the socket is open.
 */
export function keepAlive(ws: WebSocket, intervalMs = MACHINE_INTERVAL_MS, { endOnWake = true } = {}) {
  let alive = true;
  let last = Date.now();
  const mark = () => { alive = true; };
  ws.on('pong', mark); ws.on('ping', mark); ws.on('message', mark);
  const timer = setInterval(() => {
    const now = Date.now();
    const woke = endOnWake && now - last > intervalMs * 2;
    last = now;
    if (!alive || woke) { clearInterval(timer); ws.terminate(); return; }
    alive = false;
    ws.ping();
  }, intervalMs);
  timer.unref?.();
  ws.once('close', () => clearInterval(timer));
}
