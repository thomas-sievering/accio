import { spawn, fork } from 'node:child_process';
import { watch } from 'node:fs';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { join } from 'node:path';

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const build = spawn(pnpm, ['--filter', '@accio/hub...', 'build'], { stdio: 'inherit', shell: process.platform === 'win32', windowsHide: true });
const code = await new Promise((resolve) => build.once('exit', resolve));
if (code !== 0) process.exit(code ?? 1);
const home = process.env.ACCIO_DEV_HUB_HOME ?? join(process.env.LOCALAPPDATA ?? join(homedir(), '.local', 'share'), 'accio-dev');
const env = { ...process.env, ACCIO_HOME: home, ACCIO_HOST: '127.0.0.1', ACCIO_HUB_PORT: process.env.ACCIO_DEV_HUB_PORT ?? '47323' };
console.log(`Local dev hub state: ${home}`);
// TypeScript 7's launcher wraps a native child on Windows. Own that executable
// directly so stopping the watcher never needs to kill a shell process tree.
const tsRequire = createRequire(createRequire(import.meta.url).resolve('typescript/package.json'));
const { default: getCompilerPath } = await import(pathToFileURL(tsRequire.resolve('#getExePath')).href);
const compiler = spawn(getCompilerPath(), ['-b', 'apps/hub', '--watch', '--preserveWatchOutput'], { stdio: 'inherit', windowsHide: true });
const start = () => fork('apps/hub/dist/main.js', [], { stdio: ['inherit', 'inherit', 'inherit', 'ipc'], env, windowsHide: true });
let hub = start();
let stopping = false;
let debounce;
let restarting = Promise.resolve();
async function closeHub() {
  if (hub.exitCode !== null || hub.signalCode !== null) return;
  const exited = once(hub, 'exit');
  hub.send({ type: 'shutdown' });
  await exited;
}
const watchers = ['apps/hub/dist', 'packages/codex/dist', 'packages/protocol/dist', 'packages/persistence/dist'].map((dir) => watch(dir, { recursive: true }, (_event, file) => {
  if (!file?.endsWith('.js') || stopping) return;
  clearTimeout(debounce);
  debounce = setTimeout(() => { restarting = restarting.then(async () => { if (stopping) return; await closeHub(); if (!stopping) hub = start(); }); }, 300);
}));
async function stop() {
  if (stopping) return;
  stopping = true; clearTimeout(debounce); watchers.forEach((watcher) => watcher.close());
  if (compiler.exitCode === null) { const exited = once(compiler, 'exit'); compiler.kill(); await exited; }
  await restarting; await closeHub();
  if (process.connected) process.disconnect();
}
process.on('SIGINT', () => void stop()); process.on('SIGTERM', () => void stop());
process.on('message', (message) => { if (message?.type === 'shutdown') void stop(); });
compiler.on('exit', () => { if (!stopping) void stop(); });
