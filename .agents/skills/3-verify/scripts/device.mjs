// The verify device: one machine identity paired with a real hub (Home server) whose accounts are
// already signed in. Real-model journeys and `pnpm try` start from a fresh home that already joined
// that hub, so provider credentials stay on the hub. One user holds the device at a time.
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const devicePath = resolve(process.env.ACCIO_VERIFY_DEVICE ?? join(homedir(), '.accio-verify', 'device.json'));
const lockPath = devicePath + '.lock';
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const save = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** Claims the device for this process; `owner` says who holds it to anyone else waiting. Returns the release. */
export async function lockDevice(owner, { waitMs = 15 * 60_000 } = {}) {
  await mkdir(dirname(devicePath), { recursive: true });
  let announced = false;
  for (const deadline = Date.now() + waitMs; ; await delay(1000)) {
    try {
      await mkdir(lockPath);
      await save(join(lockPath, 'owner.json'), { pid: process.pid, runDir: owner });
      return async () => { await rm(lockPath, { recursive: true, force: true }); };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const held = await json(join(lockPath, 'owner.json')).catch(() => null);
      if (held && !alive(held.pid)) { await rm(lockPath, { recursive: true, force: true }); continue; }
      const who = held?.runDir ?? lockPath;
      assert(Date.now() < deadline, waitMs ? `The verify device stayed busy for ${Math.round(waitMs / 60_000)} minutes; held by ${who}` : `The verify device is in use by ${who}. Close that one first.`);
      if (!announced) { console.log(`Waiting for the verify device; another run holds it: ${who}`); announced = true; }
    }
  }
}

/** Before the server starts: this home is the verify device, already joined to its hub. */
export async function seedLinkedHome(home) {
  const device = await json(devicePath).catch(() => null);
  assert(device?.machineId && device?.hub?.token, `No verify device at ${devicePath}. Link one first: see "Real model turns" in the 3-verify skill.`);
  await save(join(home, 'machine.json'), { id: device.machineId });
  await save(join(home, 'hub-connections.json'), [{ ...device.hub, local: false, home: join(home, 'hubs', device.hub.id) }]);
  return { url: device.hub.url, name: device.hub.name, machineId: device.machineId };
}

/** After a passing link journey: keep this run's machine identity and its new hub pairing. */
export async function saveDevice(home, url) {
  const { id: machineId } = await json(join(home, 'machine.json'));
  const hub = (await json(join(home, 'hub-connections.json'))).find((h) => !h.local && h.url.replace(/\/$/, '') === url.replace(/\/$/, ''));
  assert(hub, `The link journey did not pair with ${url}`);
  const { id, name, url: saved, token } = hub;
  await writeFile(devicePath, JSON.stringify({ machineId, hub: { id, name, url: saved, token }, linkedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
  return { machineId, hubId: id, url: saved };
}
