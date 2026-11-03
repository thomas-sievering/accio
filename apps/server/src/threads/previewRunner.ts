/** Child wrapper: IPC loss on a server crash stops this preview's entire process tree. */
import { execFile, spawn } from 'node:child_process';
const [cwd, command, port] = process.argv.slice(2) as [string, string, string];
const child = spawn(command.replaceAll('{port}', port), {
  cwd, shell: true, windowsHide: true, detached: process.platform !== 'win32', stdio: 'ignore',
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
child.on('exit', () => { if (!stopping) stop(); });
process.on('message', (message: any) => { if (message?.type === 'stop') stop(); });
process.on('disconnect', stop);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
