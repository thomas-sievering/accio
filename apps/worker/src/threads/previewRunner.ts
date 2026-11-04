/**
 * Child wrapper: IPC loss on a server crash stops this preview's entire process tree.
 * Project apps also pass a log file for the command's output and hear how it exited.
 */
import { execFile, spawn } from 'node:child_process';
import { openSync } from 'node:fs';
const [cwd, command, port, logPath] = process.argv.slice(2) as [string, string, string, string | undefined];
const log = logPath ? openSync(logPath, 'a') : 'ignore';
const child = spawn(command.replaceAll('{port}', port), {
  cwd, shell: true, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', log, log],
});
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  if (!child.pid) { process.exit(); return; }
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, (error) => process.exit(error && child.exitCode === null ? 1 : 0));
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    setTimeout(() => {
      try { process.kill(-child.pid!, 'SIGKILL'); } catch {}
      process.exit();
    }, 1000);
  }
}
child.on('error', () => { process.send?.({ error: 'Could not start the preview command.' }); stop(); });
child.on('exit', (code, signal) => {
  if (stopping) return;
  process.send?.({ exited: code ?? signal });
  stop();
});
process.on('message', (message: any) => { if (message?.type === 'stop') stop(); });
process.on('disconnect', stop);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
