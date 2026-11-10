import { createServer } from 'node:http';
import { API_PREFIX, manageSortingHat } from './api.js';
import { forwardModelRequests, listen, sendError, type ForwardingOptions } from './proxy.js';
import type { SortingHat } from './sortingHat.js';

export type ServerOptions = Omit<ForwardingOptions, 'accounts'> & {
  hat: SortingHat;
  host: string;
  port: number;
  /** Turns the management API on; an embedding app calls the Sorting Hat directly instead. */
  adminToken?: string;
};

/**
 * The Sorting Hat's one HTTP server. `/healthz` answers anyone, `/api/` is the
 * management API (admin token), and every other path is a model route (hat key).
 * The dashboard will take `/` (#133).
 */
export function startServer({ hat, host, port, adminToken, ...forwarding }: ServerOptions) {
  const models = forwardModelRequests({ accounts: hat, ...forwarding });
  const api = adminToken ? manageSortingHat(hat, adminToken) : undefined;
  return listen(createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]!;
    if (path === '/healthz' && (req.method === 'GET' || req.method === 'HEAD')) {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return void res.end(req.method === 'HEAD' ? undefined : '{"ok":true}');
    }
    if (path === API_PREFIX.slice(0, -1) || path.startsWith(API_PREFIX)) {
      if (!api) return sendError(res, 404, 'not_found_error', 'This Sorting Hat has no management API.');
      return api(req, res);
    }
    models(req, res);
  }), host, port);
}
