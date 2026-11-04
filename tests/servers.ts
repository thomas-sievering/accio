import { fork, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import type { FullConfig } from '@playwright/test';

/**
 * Starts one fixture server per selected project (`scripts/<project>-test-server.ts`) on the port the config chose.
 * The servers are owned over IPC so each can flush and erase its private temporary home before exiting, on Windows too.
 */
export default async function setup(config: FullConfig) {
  const selected = process.argv.flatMap((arg, i, argv) => arg === '--project' ? [argv[i + 1]] : arg.startsWith('--project=') ? [arg.slice(10)] : []);
  const names = config.projects.map(project => project.name).filter(name => !selected.length || selected.includes(name));
  const servers = await Promise.allSettled(names.map(start));
  const stop = async () => { await Promise.all(servers.map(server => server.status === 'fulfilled' ? server.value() : undefined)); };
  const failed = servers.find(server => server.status === 'rejected');
  if (failed) { await stop().catch(() => {}); throw failed.reason; }
  return stop;
}

async function start(name: string) {
  const child = fork(resolve(`scripts/${name}-test-server.ts`), { execArgv: ['--import', 'tsx'], windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let log = ''; child.stdout?.on('data', data => { log += String(data); }); child.stderr?.on('data', data => { log += String(data); });
  try {
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(() => reject(new Error(`The ${name} fixture startup timed out: ${log.slice(-2000)}`)), 30_000);
      child.once('error', reject);
      child.once('exit', () => { clearTimeout(timer); reject(new Error(`The ${name} fixture could not start: ${log.slice(-2000)}`)); });
      child.on('message', message => { if ((message as { type?: string })?.type === 'ready') { clearTimeout(timer); done(); } });
    });
  } catch (error) { child.kill(); throw error; }
  return () => stop(name, child, () => log);
}

function stop(name: string, child: ChildProcess, log: () => string) {
  return new Promise<void>((done, reject) => {
    const failed = () => new Error(`The ${name} fixture cleanup failed: ${log().slice(-2000)}`);
    if (child.exitCode !== null) { child.exitCode === 0 ? done() : reject(failed()); return; }
    const timer = setTimeout(() => { child.kill(); reject(new Error(`The ${name} fixture did not finish cleanup.`)); }, 10_000);
    child.removeAllListeners('exit');
    child.once('exit', code => { clearTimeout(timer); code === 0 ? done() : reject(failed()); });
    child.send({ type: 'shutdown' });
  });
}
