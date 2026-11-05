import { afterEach, describe, expect, it } from 'vitest';
import { startTestApp, TestClient } from '../testing/testApp.js';

describe('machine (walking skeleton)', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  afterEach(() => t?.stop());

  it('answers machine.get over an authorised socket', async () => {
    t = await startTestApp();
    const client = await t.connect();
    const info = await client.call('machine.get', {});
    // Run from Accio's checkout, the version counts its commits.
    expect(info.version).toMatch(/^0\.1\.\d+$/);
    expect(info.name.length).toBeGreaterThan(0);
  });

  it('refuses a socket without the machine token', async () => {
    t = await startTestApp();
    await expect(TestClient.open(`${t.url}?token=wrong`)).rejects.toThrow(/401/);
    await expect(TestClient.open(t.url)).rejects.toThrow(/401/);
  });

  it('rejects unknown methods with an error, not a crash', async () => {
    t = await startTestApp();
    const client = await t.connect();
    await expect(client.call('nope' as 'machine.get', {})).rejects.toThrow(/Unknown method/);
  });
});
