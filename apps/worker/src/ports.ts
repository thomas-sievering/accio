import { createConnection, createServer } from 'node:net';

export function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (connected: boolean) => { socket.destroy(); resolve(connected); };
    socket.once('connect', () => finish(true)); socket.once('error', () => finish(false)); socket.setTimeout(300, () => finish(false));
  });
}

export async function portFree(port: number): Promise<boolean> {
  const server = createServer();
  const ok = await new Promise<boolean>((resolve) => { server.once('error', () => resolve(false)); server.listen(port, '127.0.0.1', () => resolve(true)); });
  if (ok) await new Promise<void>((resolve) => server.close(() => resolve()));
  return ok;
}

export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
