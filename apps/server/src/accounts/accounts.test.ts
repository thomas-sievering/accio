import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startTestApp } from '../testing/testApp.js';

describe('accounts slice', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  afterEach(() => t?.stop());

  it('saves an account, writes its Claude config folder and tells every client', async () => {
    t = await startTestApp();
    const a = await t.connect();
    const b = await t.connect();

    const saved = await a.call('accounts.save', { name: 'HRC', isJob: true, hubUrl: 'https://hub.test:8318', hubKey: 'secret' });
    expect(saved).toEqual({ id: 'hrc', name: 'HRC', isJob: true, hubUrl: 'https://hub.test:8318', hasHubKey: true, roots: [] });

    const pushed = await b.waitFor('accounts.changed', (list) => list.length === 1);
    expect(JSON.stringify(pushed)).not.toContain('secret');

    const settings = JSON.parse(await readFile(join(t.home, 'accounts', 'hrc', 'claude', 'settings.json'), 'utf8'));
    expect(settings.env).toEqual({ ANTHROPIC_BASE_URL: 'https://hub.test:8318', ANTHROPIC_AUTH_TOKEN: 'secret' });
  });

  it('keeps accounts across a restart and refuses invalid ones with a readable error', async () => {
    t = await startTestApp();
    const c = await t.connect();
    await c.call('accounts.save', { name: 'Personal', isJob: false, hubUrl: 'https://hub.test', hubKey: 'k' });
    await expect(c.call('accounts.save', { name: 'Job', isJob: true, hubUrl: 'https://hub.test/', hubKey: 'k2' })).rejects.toThrow(
      /needs a hub proxy of its own/,
    );

    const list = await c.call('accounts.list', {});
    expect(list.map((x) => x.id)).toEqual(['personal']);

    await c.call('accounts.delete', { id: 'personal' });
    expect(await c.call('accounts.list', {})).toEqual([]);
  });
});
