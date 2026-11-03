import { fork } from 'node:child_process';
import { resolve } from 'node:path';

/** Own the fixture process and let it flush/erase its private files before exiting on Windows too. */
export default async function setup() {
  const child = fork(resolve('scripts/secrets-test-server.ts'), { execArgv: ['--import', 'tsx'], windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let log = ''; child.stdout?.on('data', data => { log += String(data); }); child.stderr?.on('data', data => { log += String(data); });
  const stop = () => new Promise<void>((done, reject) => {
    if (child.exitCode !== null) { child.exitCode === 0 ? done() : reject(new Error('Secret fixture exited unexpectedly.')); return; }
    const timer = setTimeout(() => { child.kill(); reject(new Error('Secret fixture did not finish cleanup.')); }, 10_000);
    child.once('exit', code => { clearTimeout(timer); code === 0 ? done() : reject(new Error('Secret fixture cleanup failed.')); });
    child.send({ type: 'shutdown' });
  });
  try {
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(() => reject(new Error('Secret fixture startup timed out.')), 30_000);
      child.once('error', reject);
      child.once('exit', () => { clearTimeout(timer); reject(new Error(`Secret fixture could not start: ${log.slice(-2000)}`)); });
      child.on('message', message => { if ((message as { type?: string })?.type === 'ready') { clearTimeout(timer); done(); } });
    });
  } catch (error) { child.kill(); throw error; }
  return stop;
}
