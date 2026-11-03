import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { JsonFile } from '@accio/persistence';
import { FakeHarness, gate } from '../testing/fakeHarness.js';
import { startTestApp } from '../testing/testApp.js';

let t: Awaited<ReturnType<typeof startTestApp>>;
let requestId = 0;
const rpc = (method: string, params: unknown) => t.app.router.handle({ id: ++requestId, method, params });
afterEach(async () => { vi.restoreAllMocks(); await t?.stop(); });

it('protects the profile while a new thread has not yet been stored', async () => {
  t = await startTestApp({ harness: new FakeHarness() });
  await (await t.connect()).signedIn('Personal');
  const entered = gate();
  const held = gate();
  const access = t.app.profiles.hubAccess.bind(t.app.profiles);
  vi.spyOn(t.app.profiles, 'hubAccess').mockImplementation(async (id) => {
    entered.release();
    await held.opened;
    return access(id);
  });
  const starting = rpc('threads.start', { profileId: 'personal', text: 'hello' });
  try {
    await entered.opened;
    expect(await rpc('profiles.delete', { id: 'personal' })).toMatchObject({ ok: false });
  } finally { held.release(); }
  expect(await starting).toMatchObject({ ok: true });
});

it('rejects new profile references once deletion has begun', async () => {
  t = await startTestApp({ harness: new FakeHarness() });
  const c = await t.connect();
  await c.signedIn('Personal');
  await c.call('profiles.save', { name: 'Other' });
  const path = join(t.home, 'repo');
  await mkdir(path);
  const checkout = await c.call('checkouts.add', { path, profileId: 'other' });
  const entered = gate();
  const held = gate();
  const remove = t.app.hub.removeProfile.bind(t.app.hub);
  vi.spyOn(t.app.hub, 'removeProfile').mockImplementation(async (...args) => {
    entered.release();
    await held.opened;
    return remove(...args);
  });
  const deleting = rpc('profiles.delete', { id: 'personal' });
  try {
    await entered.opened;
    expect(await rpc('threads.start', { profileId: 'personal', text: 'too late' })).toMatchObject({ ok: false });
    expect(await rpc('checkouts.add', { path: join(t.home, 'other'), profileId: 'personal' })).toMatchObject({ ok: false });
    expect(await rpc('projects.setProfile', { projectId: checkout.projectId, profileId: 'personal' })).toMatchObject({ ok: false });
  } finally { held.release(); }
  expect(await deleting).toMatchObject({ ok: true });
  expect((await c.call('projects.get', {})).projects[0]?.profileId).toBe('other');
  expect(await c.call('threads.list', {})).toEqual([]);
});

it('protects a profile during asynchronous folder inspection', async () => {
  t = await startTestApp();
  const c = await t.connect();
  await c.call('profiles.save', { name: 'Personal' });
  const path = join(t.home, 'repo');
  await mkdir(path);
  const adding = rpc('checkouts.add', { path, profileId: 'personal' });
  expect(await rpc('profiles.delete', { id: 'personal' })).toMatchObject({ ok: false });
  expect(await adding).toMatchObject({ ok: true });
  expect((await c.call('profiles.list', {}))[0]?.id).toBe('personal');
});

it('drains all accepted profile changes before shutdown and refuses later changes', async () => {
  t = await startTestApp();
  const entered = gate();
  const held = gate();
  const write = JsonFile.prototype.write;
  vi.spyOn(JsonFile.prototype, 'write').mockImplementation(async function (value) {
    if (this.path === join(t.home, 'hub', 'settings.json')) {
      entered.release();
      await held.opened;
    }
    return write.call(this, value);
  });
  const first = rpc('profiles.save', { name: 'First' });
  const second = rpc('profiles.save', { name: 'Second' });
  await entered.opened;
  const closing = t.app.close();
  try {
    expect(await rpc('profiles.save', { name: 'Too late' })).toMatchObject({ ok: false });
  } finally { held.release(); }
  expect(await first).toMatchObject({ ok: true });
  expect(await second).toMatchObject({ ok: true });
  await closing;
  const stored = JSON.parse(await readFile(join(t.home, 'hub', 'settings.json'), 'utf8'));
  expect(stored.profiles.map((p: { name: string }) => p.name)).toEqual(['First', 'Second']);
});
