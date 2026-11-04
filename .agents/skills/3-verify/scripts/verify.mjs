#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile, fork } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(join(root, 'apps/server/package.json'));
const WebSocket = require('ws');
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const save = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
const delay = (ms) => new Promise((done) => setTimeout(done, ms));

async function fingerprint() {
  const hash = createHash('sha256');
  for (const base of ['apps/server/dist', 'apps/hub/dist', 'apps/web/dist', 'packages/protocol/dist', 'packages/persistence/dist', 'packages/codex/dist']) {
    for (const name of (await readdir(join(root, base), { recursive: true })).sort()) {
      if (!/\.(js|html|css)$/.test(name)) continue;
      hash.update(base + '/' + name).update(await readFile(join(root, base, name)));
    }
  }
  return hash.digest('hex');
}

function ownedRun(runDir) {
  const base = join(root, 'out', 'verify');
  const tail = relative(base, resolve(runDir));
  assert(tail && !tail.startsWith('..') && !isAbsolute(tail) && !tail.includes(sep), 'Expected one run directory inside out/verify');
  return resolve(runDir);
}

async function rpc(url, token, method) {
  const socket = new WebSocket(url.replace(/^http/, 'ws') + '/ws?token=' + encodeURIComponent(token));
  try {
    return await new Promise((done, fail) => {
      const timer = setTimeout(() => { socket.terminate(); fail(new Error(`RPC timeout: ${method}`)); }, 7000);
      const finish = (error, result) => { clearTimeout(timer); error ? fail(error) : done(result); };
      socket.once('error', (error) => finish(error));
      socket.once('open', () => socket.send(JSON.stringify({ id: 1, method, params: {} })));
      socket.on('message', (data) => {
        const message = JSON.parse(String(data));
        if (message.type === 'response' && message.id === 1) finish(message.ok ? null : new Error(message.error), message.result);
      });
    });
  } finally { socket.close(); }
}

// Read-only: verifies the run's process, build, authenticated transport and loaded domains.
export async function doctor(runDir) {
  runDir = ownedRun(runDir);
  const instance = await json(join(runDir, 'instance.json'));
  assert.equal(instance.root, root, 'Different checkout');
  assert.equal(instance.home, join(runDir, 'scratch', 'home'), 'Unexpected data directory');
  process.kill(instance.pid, 0);
  assert.equal(await fingerprint(), instance.build, 'Build changed; start a fresh verification run');
  const { token } = await json(join(instance.home, 'server.json'));
  const storedMachine = await json(join(instance.home, 'machine.json'));
  const response = await fetch(instance.url, { signal: AbortSignal.timeout(7000) });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<div id="root">/);
  const [machines, profiles, accounts, projects, threads] = await Promise.all(
    ['machines.list', 'profiles.list', 'accounts.list', 'projects.get', 'threads.list'].map((method) => rpc(instance.url, token, method)),
  );
  assert(machines.some((m) => m.id === storedMachine.id && m.thisMachine && m.connected), 'Fresh machine not connected');
  assert(Array.isArray(profiles) && Array.isArray(accounts) && Array.isArray(projects.projects) && Array.isArray(threads));
  return { ok: true, url: instance.url, pid: instance.pid, home: instance.home, build: instance.build, machineId: storedMachine.id,
    counts: { profiles: profiles.length, accounts: accounts.length, projects: projects.projects.length, threads: threads.length } };
}

async function run(journeyFile) {
  const runDir = join(root, 'out', 'verify', new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8));
  const scratch = join(runDir, 'scratch');
  const home = join(scratch, 'home');
  const fixture = join(scratch, 'verify-project');
  await mkdir(home, { recursive: true });
  await mkdir(fixture);
  console.log(`Evidence: ${runDir}`);
  let child, browser, context, page, instance;
  let result = { status: 'failed', journey: journeyFile, startedAt: new Date().toISOString(), runDir };
  const actions = [], browserErrors = [], requests = [];
  let serverOutput = '';
  const action = async (label, perform) => {
    const entry = { label, at: new Date().toISOString(), status: 'started' };
    actions.push(entry);
    await save(join(runDir, 'actions.json'), actions);
    try {
      await perform();
      entry.status = 'passed';
    } catch (error) {
      entry.status = 'failed';
      entry.error = String(error);
      throw error;
    } finally { await save(join(runDir, 'actions.json'), actions); }
  };
  const capture = async (name) => {
    assert(/^[a-z0-9-]+$/.test(name));
    await page.screenshot({ path: join(runDir, name + '.png'), fullPage: true });
    await writeFile(join(runDir, name + '.aria.yml'), await page.locator('body').ariaSnapshot());
  };
  let stopping;
  const stopChild = () => stopping ??= (async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    if (child.connected) child.send({ type: 'shutdown' });
    else child.kill();
    let timer;
    const stopped = await Promise.race([exited.then(() => true), new Promise((done) => { timer = setTimeout(() => done(false), 10000); })]);
    clearTimeout(timer);
    if (!stopped) { child.kill('SIGKILL'); await exited; }
  })();
  const onSignal = () => { process.exitCode = 130; void browser?.close(); void stopChild(); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    const build = await fingerprint();
    // Keep git discovery inside the fixture instead of finding Accio's parent repo.
    const git = await promisify(execFile)('git', ['init', '--quiet', fixture], { windowsHide: true });
    await save(join(runDir, 'fixture.json'), { command: ['git', 'init', '--quiet', fixture], exitCode: 0, stdout: git.stdout, stderr: git.stderr });
    child = fork(join(root, 'apps/server/dist/main.js'), [], {
      cwd: root, silent: true, windowsHide: true,
      env: { ...process.env, ACCIO_HOME: home, ACCIO_PORT: '0', ACCIO_HUB_PORT: '0', ACCIO_HOST: '127.0.0.1', ACCIO_WEB_ROOT: join(root, 'apps/web/dist') },
    });
    child.stdout.on('data', (data) => { serverOutput += String(data); });
    child.stderr.on('data', (data) => { serverOutput += String(data); });
    let launchError;
    child.on('error', (error) => { launchError = error; });
    const deadline = Date.now() + 45000;
    while (!serverOutput.includes('ACCIO_READY ')) {
      if (launchError) throw launchError;
      assert(child.exitCode === null && child.signalCode === null, `Server exited before ready: ${serverOutput}`);
      assert(Date.now() < deadline, 'Timed out waiting for ACCIO_READY');
      await delay(100);
    }
    const ready = JSON.parse(serverOutput.match(/ACCIO_READY (\{[^\r\n]+\})/)[1]);
    instance = { root, home, pid: child.pid, url: ready.url, build };
    await save(join(runDir, 'instance.json'), instance);
    await save(join(runDir, 'doctor.json'), await doctor(runDir));
    browser = await chromium.launch({ headless: process.env.ACCIO_VERIFY_HEADED !== '1' });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => browserErrors.push(String(error)));
    context.on('request', (request) => {
      const target = new URL(request.url());
      requests.push({ method: request.method(), origin: target.origin, path: target.pathname });
    });
    await action('Open authenticated production UI', () => page.goto(ready.url + '/#token=' + ready.token));
    await page.getByRole('heading', { name: 'Set up Accio', exact: true }).waitFor();
    await capture('initial');
    const { default: journey } = await import(pathToFileURL(resolve(journeyFile)).href);
    await journey({ page, context, runDir, home, fixture, action, capture, doctor: () => doctor(runDir) });
    assert.deepEqual(browserErrors, [], 'Uncaught browser errors');
    result.status = 'passed';
  } catch (error) {
    result.error = error.stack ?? String(error);
    if (page) await capture('failure').catch(() => {});
    process.exitCode = 1;
  } finally {
    await save(join(runDir, 'actions.json'), actions);
    await save(join(runDir, 'browser-errors.json'), browserErrors);
    await save(join(runDir, 'requests.json'), requests);
    await context?.tracing.stop({ path: join(runDir, 'trace.zip') }).catch(() => {});
    await browser?.close().catch(() => {});
    await stopChild();
    // Scratch is a fixed child of a freshly generated, validated run directory.
    ownedRun(runDir);
    assert.equal(scratch, join(runDir, 'scratch'));
    await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    // Record actual socket closure; connection refusal is expected after teardown.
    let portClosed = true;
    if (instance) {
      portClosed = await fetch(instance.url, { signal: AbortSignal.timeout(2000) }).then(() => false, () => true);
      assert(portClosed, 'Owned server port still answers after cleanup');
    }
    await writeFile(join(runDir, 'server.log'), serverOutput.replace(/#token=[^\s]+/g, '#token=[redacted]').replace(/"token":"[^"]+"/g, '"token":"[redacted]"'));
    await save(join(runDir, 'cleanup.json'), { serverExited: !child || child.exitCode !== null || child.signalCode !== null, portClosed, scratchRemoved: true, evidenceRetained: true });
    result.finishedAt = new Date().toISOString();
    await save(join(runDir, 'result.json'), result);
    assert((await readdir(runDir)).includes('result.json'));
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
  console.log(`${result.status.toUpperCase()}: ${runDir}`);
  if (result.error) console.error(result.error);
}

const [command, argument] = process.argv.slice(2);
if (command === 'doctor') {
  console.log(JSON.stringify(await doctor(resolve(argument ?? '')), null, 2));
} else {
  await run(command ? resolve(command) : join(dirname(fileURLToPath(import.meta.url)), 'smoke.mjs'));
}
