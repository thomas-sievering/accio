import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startTestApp } from '../testing/testApp.js';
import { connection, runCli, type CliIO } from './run.js';

function capture(input = '') {
  const stdout: string[] = [], stderr: string[] = [];
  const io: CliIO = { out: (text) => { stdout.push(text); }, err: (text) => { stderr.push(text); }, stdin: async () => input };
  return { io, stdout, stderr };
}

describe('terminal client', () => {
  const cleanups: (() => Promise<unknown>)[] = [];
  afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

  it('discovers methods and schemas without a worker', async () => {
    const c = capture();
    expect(await runCli(['methods', 'threads.'], c.io, {})).toBe(0);
    expect(JSON.parse(c.stdout[0]!)).toContain('threads.start');
    expect(await runCli(['schema', 'threads.send'], c.io, {})).toBe(0);
    expect(JSON.parse(c.stdout[1]!).required).toContain('threadId');
  });

  it('uses the real authenticated worker to write and read a profile', async () => {
    const server = await startTestApp(); cleanups.push(() => server.stop());
    await writeFile(join(server.home, 'server.json'), JSON.stringify({ host: '127.0.0.1', port: server.app.port, token: 'test-token' }));
    const c = capture(JSON.stringify({ name: 'Terminal test' }));
    expect(await runCli(['--home', server.home, 'profiles.save', '-'], c.io, {})).toBe(0);
    const profile = JSON.parse(c.stdout[0]!);
    expect(profile.name).toBe('Terminal test');
    expect(await runCli(['--home', server.home, 'call', 'profiles.list'], c.io, {})).toBe(0);
    expect(JSON.parse(c.stdout[1]!).some((item: { id: string }) => item.id === profile.id)).toBe(true);
    expect(c.stderr).toEqual([]);
  });

  it('rejects invalid params without echoing private input or creating a connection', async () => {
    const c = capture();
    expect(await runCli(['threads.send', '{"text":"private-value"}'], c.io, {})).toBe(1);
    expect(c.stderr.join()).not.toContain('private-value');
    expect(c.stdout).toEqual([]);
    expect(await runCli(['threads.send', 'private-value'], c.io, {})).toBe(1);
    expect(c.stderr.join()).not.toContain('private-value');
  });

  it('does not borrow a local credential for an explicit remote address', async () => {
    await expect(connection({ url: 'https://example.com' }, {})).rejects.toThrow('Missing worker token');
    const url = await connection({ url: 'https://example.com/#token=private', hub: 'work' }, {});
    expect(url.protocol).toBe('wss:');
    expect(url.pathname).toBe('/ws');
    expect(url.searchParams.get('hub')).toBe('work');
    expect(url.hash).toBe('');
  });

  async function fixture(reply: (ws: import('ws').WebSocket, message: any) => void) {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => wss.once('listening', resolve));
    cleanups.push(() => new Promise<void>((resolve) => { for (const ws of wss.clients) ws.terminate(); wss.close(() => resolve()); }));
    wss.on('connection', (ws) => ws.on('message', (raw) => reply(ws, JSON.parse(String(raw)))));
    const address = wss.address();
    if (typeof address !== 'object' || !address) throw new Error('No fixture port');
    return { ACCIO_URL: `http://127.0.0.1:${address.port}`, ACCIO_TOKEN: 'test' };
  }

  it('waits for completion and reports failed threads with a failing exit code', async () => {
    let reads = 0;
    const env = await fixture((ws, message) => ws.send(JSON.stringify({ type: 'response', id: message.id, ok: true,
      result: [{ id: 'thread', status: ++reads === 1 ? 'running' : 'failed' }] })));
    const c = capture();
    expect(await runCli(['wait', 'thread'], c.io, env)).toBe(1);
    expect(JSON.parse(c.stdout[0]!).status).toBe('failed');
    expect(reads).toBe(2);
  });

  it('bounds unresponsive requests and surfaces server errors', async () => {
    const env = await fixture((ws, message) => {
      if (message.method === 'threads.list') ws.send(JSON.stringify({ type: 'response', id: message.id, ok: false, error: 'Not available' }));
    });
    const c = capture();
    expect(await runCli(['threads.list'], c.io, env)).toBe(1);
    expect(JSON.parse(c.stderr[0]!).error).toBe('Not available');
    expect(await runCli(['profiles.list', '--timeout', '50'], c.io, env)).toBe(2);
  });

  it('streams only the selected events and exits when the connection closes', async () => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => wss.once('listening', resolve));
    cleanups.push(() => new Promise<void>((resolve) => wss.close(() => resolve())));
    wss.on('connection', (ws) => {
      ws.send(JSON.stringify({ type: 'event', event: 'ignored', data: null }));
      ws.send(JSON.stringify({ type: 'event', event: 'threads.changed', data: [] }));
      setTimeout(() => ws.close(), 50);
    });
    const address = wss.address() as { port: number };
    const c = capture();
    expect(await runCli(['events', 'threads.changed'], c.io, { ACCIO_TOKEN: 'test', ACCIO_URL: `http://127.0.0.1:${address.port}` })).toBe(1);
    expect(c.stdout.map((line) => JSON.parse(line).event)).toEqual(['threads.changed']);
  });
});
