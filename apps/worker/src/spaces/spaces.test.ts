import { afterEach, describe, expect, it } from 'vitest';
import { startTestApp } from '../testing/testApp.js';

describe('spaces through a machine', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  afterEach(() => t?.stop());

  it('tells every client when a space changes, and explains a refused save', async () => {
    t = await startTestApp();
    const a = await t.connect();
    const b = await t.connect();
    const saved = await a.call('spaces.save', { name: 'hrc', projectKeys: ['github.com/me/hrc', 'github.com/me/hrc_mcp'], homeProjectKey: 'github.com/me/hrc' });
    await b.waitFor('spaces.changed', (spaces) => spaces[0]?.id === saved.id && spaces[0].homeProjectKey === 'github.com/me/hrc');
    expect(await b.call('spaces.list', {})).toEqual([saved]);

    await expect(b.call('spaces.save', { name: 'agents', projectKeys: ['github.com/me/hrc_mcp'] })).rejects.toThrow('github.com/me/hrc_mcp is already in the space hrc');
    await b.call('spaces.delete', { id: saved.id });
    await a.waitFor('spaces.changed', (spaces) => spaces.length === 0);
  });
});
