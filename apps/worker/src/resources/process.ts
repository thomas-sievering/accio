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

export type PnpmCommand = { command: string; args: string[]; env?: NodeJS.ProcessEnv };
const exists = (path: string) => access(path).then(() => true, () => false);

/**
 * How to run pnpm without a shell, so paths with spaces stay single arguments: the pnpm that
 * started Accio, else a standalone pnpm, else pnpm's or Corepack's script run by this Node
 * (Electron runs as Node through ELECTRON_RUN_AS_NODE).
 */
export async function pnpmCli(env: NodeJS.ProcessEnv = process.env, platform = process.platform, execPath = process.execPath): Promise<PnpmCommand> {
  const asNode = (script: string): PnpmCommand => ({ command: execPath, args: [script], env: { ...env, ELECTRON_RUN_AS_NODE: '1' } });
  const started = env.npm_execpath;
  if (started && /pnpm/i.test(started) && await exists(started)) {
    if (/\.[cm]?js$/.test(started)) return asNode(started);
    if (platform !== 'win32' || /\.exe$/i.test(started)) return { command: started, args: [] };
  }
  const folders = [dirname(execPath), ...(env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)];
  for (const folder of folders) {
    const standalone = join(folder, platform === 'win32' ? 'pnpm.exe' : 'pnpm');
    if (platform === 'win32' && await exists(standalone)) return { command: standalone, args: [] };
    for (const script of ['node_modules/pnpm/bin/pnpm.cjs', '../lib/node_modules/pnpm/bin/pnpm.cjs', 'node_modules/corepack/dist/pnpm.js', '../lib/node_modules/corepack/dist/pnpm.js']) {
      if (await exists(join(folder, script))) return asNode(join(folder, script));
    }
    if (platform !== 'win32' && await exists(standalone)) return { command: standalone, args: [] };
  }
  throw new Error('pnpm is required to install CLIs; install pnpm or enable Corepack on this machine.');
}
