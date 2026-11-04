#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile, fork } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(join(root, 'apps/worker/package.json'));
const WebSocket = require('ws');
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const save = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
// Teardown steps must finish; a stuck browser or trace must not block stopping the servers.
const within = (ms, promise) => Promise.race([Promise.resolve(promise).catch(() => {}), delay(ms)]);

async function fingerprint() {
  const hash = createHash('sha256');
  for (const base of ['apps/worker/dist', 'apps/hub/dist', 'apps/web/dist', 'packages/protocol/dist', 'packages/persistence/dist', 'packages/codex/dist']) {
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

async function rpc(url, token, method, params = {}) {
  const socket = new WebSocket(url.replace(/^http/, 'ws') + '/ws?token=' + encodeURIComponent(token));
  try {
    return await new Promise((done, fail) => {
      const timer = setTimeout(() => { socket.terminate(); fail(new Error(`RPC timeout: ${method}`)); }, 7000);
      const finish = (error, result) => { clearTimeout(timer); error ? fail(error) : done(result); };
      socket.once('error', (error) => finish(error));
      socket.once('open', () => socket.send(JSON.stringify({ id: 1, method, params })));
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

// The verify device: one machine identity paired with a real hub (Home server) whose accounts are
// already signed in. Real-model journeys start from a fresh home that already joined that hub, so
// provider credentials stay on the hub. One run uses the device at a time.
const devicePath = resolve(process.env.ACCIO_VERIFY_DEVICE ?? join(homedir(), '.accio-verify', 'device.json'));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function lockDevice(runDir) {
  await mkdir(dirname(devicePath), { recursive: true });
  const lock = devicePath + '.lock';
  let announced = false;
  for (const deadline = Date.now() + 15 * 60_000; ; await delay(1000)) {
    try {
      await mkdir(lock);
      await save(join(lock, 'owner.json'), { pid: process.pid, runDir });
      return async () => { await rm(lock, { recursive: true, force: true }); };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = await json(join(lock, 'owner.json')).catch(() => null);
      if (owner && !alive(owner.pid)) { await rm(lock, { recursive: true, force: true }); continue; }
      assert(Date.now() < deadline, `The verify device stayed busy for 15 minutes (lock ${lock})`);
      if (!announced) { console.log(`Waiting for the verify device; another run holds it: ${owner?.runDir ?? lock}`); announced = true; }
    }
  }
}

// Before the server starts: this home is the verify device, already joined to its hub.
async function seedLinkedHome(home) {
  const device = await json(devicePath).catch(() => null);
  assert(device?.machineId && device?.hub?.token, `No verify device at ${devicePath}. Link one first: see "Real model turns" in the 3-verify skill.`);
  await save(join(home, 'machine.json'), { id: device.machineId });
  await save(join(home, 'hub-connections.json'), [{ ...device.hub, local: false, home: join(home, 'hubs', device.hub.id) }]);
  return { url: device.hub.url, name: device.hub.name, machineId: device.machineId };
}

// After a passing link journey: keep this run's machine identity and its new hub pairing.
async function saveDevice(home, url) {
  const { id: machineId } = await json(join(home, 'machine.json'));
  const hub = (await json(join(home, 'hub-connections.json'))).find((h) => !h.local && h.url.replace(/\/$/, '') === url.replace(/\/$/, ''));
  assert(hub, `The link journey did not pair with ${url}`);
  const { id, name, url: saved, token } = hub;
  await writeFile(devicePath, JSON.stringify({ machineId, hub: { id, name, url: saved, token }, linkedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
  return { machineId, hubId: id, url: saved };
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
  let failedAction, unlockDevice;
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
      failedAction ??= label;
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
    const journeyModule = await import(pathToFileURL(resolve(journeyFile)).href);
    if (journeyModule.linkedHub || journeyModule.link) unlockDevice = await lockDevice(runDir);
    if (journeyModule.linkedHub) await save(join(runDir, 'linked-hub.json'), await seedLinkedHome(home));
    // Keep git discovery inside the fixture instead of finding Accio's parent repo.
    const git = await promisify(execFile)('git', ['init', '--quiet', fixture], { windowsHide: true });
    await save(join(runDir, 'fixture.json'), { command: ['git', 'init', '--quiet', fixture], exitCode: 0, stdout: git.stdout, stderr: git.stderr });
    child = fork(join(root, 'apps/worker/dist/main.js'), [], {
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
    browser = await chromium.launch({ headless: process.env.ACCIO_VERIFY_HEADED !== '1' && !journeyModule.headed });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    page = await context.newPage();
    // Short by default so a wrong selector fails fast; raise it per call for slow real effects.
    page.setDefaultTimeout(Number(process.env.ACCIO_VERIFY_TIMEOUT_MS ?? 5000));
    page.on('pageerror', (error) => browserErrors.push(String(error)));
    context.on('request', (request) => {
      const target = new URL(request.url());
      requests.push({ method: request.method(), origin: target.origin, path: target.pathname });
    });
    await action('Open authenticated production UI', () => page.goto(ready.url + '/#token=' + ready.token));
    await page.getByRole('heading', { name: 'Set up Accio', exact: true }).waitFor();
    await capture('initial');
    const journey = journeyModule.default;
    await journey({ page, context, runDir, home, fixture, action, capture, doctor: () => doctor(runDir) });
    assert.deepEqual(browserErrors, [], 'Uncaught browser errors');
    if (journeyModule.link) await save(join(runDir, 'linked-device.json'), await saveDevice(home, journeyModule.link));
    result.status = 'passed';
  } catch (error) {
    result.error = error.stack ?? String(error);
    if (page) await within(15000, capture('failure'));
    process.exitCode = 1;
  } finally {
    await save(join(runDir, 'actions.json'), actions);
    await save(join(runDir, 'browser-errors.json'), browserErrors);
    await save(join(runDir, 'requests.json'), requests);
    await within(60000, context?.tracing.stop({ path: join(runDir, 'trace.zip') }));
    await within(15000, browser?.close());
    await stopChild();
    await unlockDevice?.();
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
  if (result.error) console.error(await failureReport(runDir, result.error, failedAction));
}

// One readable block: the failing action, the message without stack frames and, for locator
// failures, what the page actually showed. The full stack stays in result.json.
async function failureReport(runDir, error, label) {
  if (process.env.ACCIO_VERIFY_VERBOSE === '1') return error;
  const message = error.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/).filter((line) => !/^\s+at /.test(line)).join('\n').trim();
  const lines = [label ? `Failed action: ${label}` : 'Failed outside an action (launch, readiness or final checks)', message];
  if (/waiting for|strict mode violation|Timeout \d+ms exceeded/.test(message)) {
    const aria = await readFile(join(runDir, 'failure.aria.yml'), 'utf8').catch(() => '');
    if (aria) {
      const shown = aria.split(/\r?\n/);
      lines.push(`Page at failure (failure.aria.yml${shown.length > 80 ? `, first 80 of ${shown.length} lines` : ''}):`, ...shown.slice(0, 80));
    }
  }
  lines.push('Full stack: result.json. Trace: trace.zip. Set ACCIO_VERIFY_VERBOSE=1 to print the stack here.');
  return lines.join('\n');
}

const [command, argument] = process.argv.slice(2);
if (command === 'doctor') {
  console.log(JSON.stringify(await doctor(resolve(argument ?? '')), null, 2));
} else {
  await run(command ? resolve(command) : join(dirname(fileURLToPath(import.meta.url)), 'smoke.mjs'));
  // Evidence and cleanup are complete; do not let a stuck browser handle keep the runner alive.
  process.exit();
}
