import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';

export type CommandRunner = (command: string, args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number }) => Promise<string>;
/** No shell: repository URLs, paths and package names always remain arguments. */
export const runCommand: CommandRunner = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, options.timeout ?? 120_000);
  const collect = (data: Buffer) => { output = (output + data.toString()).slice(-32_000); };
  child.stdout.on('data', collect); child.stderr.on('data', collect);
  child.once('error', error => { clearTimeout(timer); reject(error); });
  child.once('close', code => { clearTimeout(timer); if (code === 0 && !timedOut) resolve(output.trim()); else reject(new Error(timedOut ? 'Command timed out' : `Command exited ${code}: ${output.trim()}`)); });
});

export async function npmCli(): Promise<string> {
  for (const folder of [dirname(process.execPath), ...(process.env.PATH ?? '').split(delimiter)]) {
    for (const path of [join(folder, 'node_modules/npm/bin/npm-cli.js'), join(folder, '../lib/node_modules/npm/bin/npm-cli.js')]) {
      if (await access(path).then(() => true, () => false)) return path;
    }
  }
  throw new Error('npm is required to install managed tools; install Node.js with npm on this machine.');
}
