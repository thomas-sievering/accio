import { execFile, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

export const help = `Usage: pnpm verify:ui <file.spec.ts>... [--project=chat|limits|secrets] [--grep <pattern>] [--skip-build]

Builds and typechecks the workspace, runs web unit tests, then only the selected browser files.
Use --skip-build only with a successful build of the current sources.
Logs and a JSON report are saved under out/verify-ui. Failures stop the run;
inspect their logs before a focused retry. No automatic retries or publishing.
Example: pnpm verify:ui delivery.spec.ts delivery-merge.spec.ts`;

export function parseArgs(args) {
  const options = { files: [], project: 'chat', skipBuild: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') continue;
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--skip-build') options.skipBuild = true;
    else if (arg.startsWith('--project=')) options.project = arg.slice(10);
    else if (arg === '--grep' && args[i + 1]) options.grep = args[++i];
    else if (/^(?:tests\/)?[\w-]+\.spec\.ts$/.test(arg)) options.files.push(arg.replace(/^tests\//, ''));
    else throw new Error(`Unknown argument: ${arg}\n${help}`);
  }
  if (!['chat', 'limits', 'secrets'].includes(options.project)) throw new Error('Choose project chat, limits or secrets.');
  if (!options.files.length) throw new Error(`Select the browser files covering the change.\n${help}`);
  return options;
}

export function plan(options, pnpm, directory) {
  // pnpm may be a JS entry point or its native executable (pnpm 12 on Windows).
  const javascript = /\.[cm]?js$/i.test(pnpm);
  const step = (name, args) => ({ name, command: javascript ? process.execPath : pnpm, args: javascript ? [pnpm, ...args] : args });
  return [
    ...(!options.skipBuild ? [step('build', ['build'])] : []),
    step('typecheck', ['typecheck']),
    step('web-unit', ['exec', 'vitest', 'run', 'apps/web']),
    step('browser', ['exec', 'playwright', 'test', ...options.files.map(file => `tests/${file}`), `--project=${options.project}`, '--retries=0', ...(directory ? [`--output=${resolve(directory, 'browser')}`] : []), ...(options.grep ? ['--grep', options.grep] : [])]),
  ];
}

/** Each stage owns a complete log; preserve its actual exit status and stop on failure. */
export async function runPlan(steps, { cwd, directory, report = {}, print = console.log }) {
  await mkdir(directory, { recursive: true });
  const summary = { ...report, startedAt: new Date().toISOString(), status: 'running', steps: [] };
  const reportPath = resolve(directory, 'report.json');
  const save = () => writeFile(reportPath, JSON.stringify(summary, null, 2) + '\n');
  await save();
  let exitCode = 0;
  for (const step of steps) {
    const logPath = resolve(directory, `${step.name}.log`);
    const log = createWriteStream(logPath);
    const started = Date.now();
    print(`Starting ${step.name}; log: ${logPath}`);
    const result = await new Promise(done => {
      const child = spawn(step.command, step.args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.pipe(log, { end: false });
      child.stderr.pipe(log, { end: false });
      child.once('error', error => log.write(`${error.stack}\n`));
      child.once('close', (code, signal) => done({ exitCode: code ?? 1, signal }));
    });
    log.end();
    await finished(log);
    summary.steps.push({ ...step, ...result, durationMs: Date.now() - started, logPath });
    await save();
    print(`${step.name}: ${result.exitCode === 0 ? 'passed' : 'failed'} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    if (result.exitCode !== 0) {
      print((await readFile(logPath, 'utf8')).split(/\r?\n/).slice(-40).join('\n'));
      exitCode = result.exitCode > 0 ? result.exitCode : 1;
      break;
    }
  }
  summary.status = exitCode === 0 ? 'passed' : 'failed';
  summary.finishedAt = new Date().toISOString();
  await save();
  print(`Verification ${summary.status}. Report: ${reportPath}`);
  return exitCode;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(help); return; }
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  for (const file of options.files) await access(resolve(cwd, 'tests', file));
  const pnpm = process.env.npm_execpath;
  if (!pnpm) throw new Error('Run through pnpm verify:ui so the pinned package manager is used.');
  const directory = resolve(cwd, 'out/verify-ui', `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`);
  const git = async args => (await promisify(execFile)('git', args, { cwd, windowsHide: true })).stdout.trim();
  const [revision, workingTree] = await Promise.all([git(['rev-parse', 'HEAD']), git(['status', '--porcelain'])]);
  process.exitCode = await runPlan(plan(options, pnpm, directory), { cwd, directory, report: { selection: options, revision, workingTree } });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
