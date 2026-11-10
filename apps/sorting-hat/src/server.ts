import { createServer } from 'node:http';
import type { AccessConfig } from './access.js';
import { API_PREFIX, manageSortingHat } from './api.js';
import { DashboardGate, isDashboardPath } from './dashboard.js';
import { forwardModelRequests, listen, sendError, type ForwardingOptions } from './proxy.js';
import type { SortingHat } from './sortingHat.js';
import type { Fetch } from './types.js';

export type ServerOptions = Omit<ForwardingOptions, 'accounts'> & {
  hat: SortingHat;
  host: string;
  port: number;
  /** What the management API accepts. */
  adminToken: string;
  /** Puts the dashboard and the management API behind Cloudflare Access; without it they open on loopback only. */
  access?: AccessConfig;
  /** Reads the Access certs; for tests. */
  accessFetch?: Fetch;
};

/**
 * The Sorting Hat's one HTTP server. `/healthz` answers anyone, `/api/` is the
 * management API (admin token), `/` and `/dashboard/` serve the dashboard
 * (dashboard.ts), and every other path is a model route (hat key).
 */
export function startServer({ hat, host, port, adminToken, access, accessFetch, ...forwarding }: ServerOptions) {
  const models = forwardModelRequests({ accounts: hat, ...forwarding });
  const gate = new DashboardGate(access, accessFetch);
  const api = manageSortingHat(hat, adminToken, { allowWithoutToken: (req) => gate.api(req) });
  return listen(createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]!;
    if (path === '/healthz' && (req.method === 'GET' || req.method === 'HEAD')) {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return void res.end(req.method === 'HEAD' ? undefined : '{"ok":true}');
    }
    if (path === API_PREFIX.slice(0, -1) || path.startsWith(API_PREFIX)) return api(req, res);
    if (isDashboardPath(path)) {
      return void gate.serve(req, res, path).catch((err) => {
        console.error('[sorting-hat] dashboard error', err);
        if (!res.headersSent) sendError(res, 500, 'api_error', 'The Sorting Hat could not show its dashboard.'); else res.destroy();
      });
    }
    models(req, res);
  }), host, port);
}
