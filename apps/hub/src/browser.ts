import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PairedClientView } from '@accio/protocol';
import { CLIENT_TTL_MS } from './trust.js';
import { HubError } from './errors.js';

const cookieName = '__Host-accio-client';
const webTypes: Record<string, string> = { html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', woff2: 'font/woff2', png: 'image/png' };

export function browserAppFile(path: string) {
  if (path === '/favicon.svg' || /^\/assets\/[\w.-]+\.(?:js|css|svg|woff2|png)$/.test(path)) return path.slice(1);
}

export async function browserApp(res: ServerResponse, root: string, file: string) {
  const body = await readFile(join(root, file)).catch(() => undefined);
  res.writeHead(body ? 200 : 404, {
    'content-type': body ? webTypes[file.split('.').at(-1)!]! : 'text/plain', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  });
  res.end(file === 'index.html' && body ? body.toString().replace('<div id="root">', '<div id="root" data-hub-client>') : body ?? 'Web app file not found');
}
export function browserToken(req: IncomingMessage) {
  return req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
}
export function browserCookie(res: ServerResponse, token: string) {
  res.setHeader('set-cookie', browserCookieValue(token));
}
export function browserCookieValue(token: string) {
  return `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${token ? CLIENT_TTL_MS / 1000 : 0}`;
}
export function browserOrigin(req: IncomingMessage, publicUrl?: string) {
  const origin = req.headers.origin;
  const address = origin && URL.parse(origin);
  if (!address || origin !== address.origin) return false;
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(address.hostname);
  if (address.protocol !== 'https:' && !(address.protocol === 'http:' && loopback)) return false;
  return publicUrl ? origin === new URL(publicUrl).origin : address.host === req.headers.host;
}
export async function browserForm(req: IncomingMessage) {
  if (req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/x-www-form-urlencoded') throw new HubError('Invalid browser form');
  let body = '';
  for await (const chunk of req) {
    body += chunk.toString();
    if (body.length > 1024) throw new HubError('Invalid browser form');
  }
  return new URLSearchParams(body);
}
export function browserName(agent = '') {
  const device = /iPad/.test(agent) ? 'iPad' : /iPhone/.test(agent) ? 'iPhone' : /Android/.test(agent) ? 'Android' : /Windows/.test(agent) ? 'Windows' : /Macintosh/.test(agent) ? 'Mac' : /Linux/.test(agent) ? 'Linux' : '';
  const browser = /Edg(?:A|iOS)?\//.test(agent) ? 'Edge' : /(?:Chrome|CriOS)\//.test(agent) ? 'Chrome' : /(?:Firefox|FxiOS)\//.test(agent) ? 'Firefox' : /Safari\//.test(agent) ? 'Safari' : '';
  return [device, browser].filter(Boolean).join(' ') || 'Browser';
}
function escape(text: string) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
export function browserPage(res: ServerResponse, signedIn?: { id: string; clients: PairedClientView[] }, error?: { status: number; message: string }) {
  const nonce = randomBytes(16).toString('base64');
  res.writeHead(error?.status ?? 200, {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'same-origin',
    'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
  });
  const content = signedIn ? `<h1>You're paired with Accio</h1><p>This hub was started without the web app.</p><h2>Paired clients</h2>${signedIn.clients.map(({ id, name }) => `<form method="post" action="/client/unpair"><input type="hidden" name="id" value="${escape(id)}"><p><b>${escape(name)}</b>${id === signedIn.id ? ' (this browser)' : ''} <button data-busy="Unpairing…">Unpair ${escape(name)}</button></p></form>`).join('')}` :
    `<h1>Pair this browser</h1><p>In Accio, open Settings → Machines → Pair a browser for a one-time code.</p>${error ? `<p role="alert">${escape(error.message)}</p>` : ''}
    <form method="post" action="/client/pair"><label for="code">Pairing code</label> <input id="code" name="code" type="text" required maxlength="64" autocomplete="off" spellcheck="false"> <button data-busy="Pairing…">Pair browser</button></form>`;
  res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Accio</title><main style="font-family:system-ui;max-width:38rem;margin:10vh auto;padding:1.5rem">${content}</main>
    <script nonce="${nonce}">
      for (const form of document.forms) form.addEventListener('submit', (event) => {
        if (form.getAttribute('aria-busy') === 'true') { event.preventDefault(); return; }
        const button = form.querySelector('button');
        form.setAttribute('aria-busy', 'true');
        button.textContent = button.dataset.busy;
        button.disabled = true;
      });
      const code = location.hash.slice(1);
      if (code || location.search === '?check-session') history.replaceState(null, '', '/');
      const input = document.getElementById('code');
      if (input && /^[0-9A-Za-z-]{1,64}$/.test(code)) { input.value = code; input.form.requestSubmit(); }
    </script></html>`);
}

export function recheckBrowserSession(res: ServerResponse) {
  const nonce = randomBytes(16).toString('base64');
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
    'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'`,
  });
  res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Accio</title><p>Opening Accio…</p><script nonce="${nonce}">location.replace('/?check-session' + location.hash);</script><noscript><a href="/?check-session">Open Accio</a></noscript></html>`);
}
