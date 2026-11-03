import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { renameAccountsToProfiles } from './renameAccountsToProfiles.js';

let home: string;
afterEach(() => rm(home, { recursive: true, force: true }));

const json = async (path: string) => JSON.parse(await readFile(join(home, path), 'utf8'));

describe('renameAccountsToProfiles', () => {
  it('moves account files, folders and ids to profile names', async () => {
    home = await mkdtemp(join(tmpdir(), 'accio-migrate-'));
    await writeFile(join(home, 'accounts.json'), JSON.stringify([{ id: 'personal', name: 'Personal', folders: [] }]));
    await mkdir(join(home, 'accounts', 'personal', 'claude'), { recursive: true });
    await writeFile(join(home, 'accounts', 'personal', 'claude', 'session.jsonl'), 'kept');
    await writeFile(join(home, 'projects.json'), JSON.stringify({ projects: [{ id: 'p', accountId: 'personal' }], checkouts: [] }));
    await writeFile(join(home, 'threads.json'), JSON.stringify([{ id: 't', accountId: 'personal' }]));

    await renameAccountsToProfiles(home);
    await renameAccountsToProfiles(home); // a second start changes nothing

    expect(await json('profiles.json')).toEqual([{ id: 'personal', name: 'Personal', folders: [] }]);
    expect(await readFile(join(home, 'profiles', 'personal', 'claude', 'session.jsonl'), 'utf8')).toBe('kept');
    expect(await json('projects.json')).toEqual({ projects: [{ id: 'p', profileId: 'personal' }], checkouts: [] });
    expect(await json('threads.json')).toEqual([{ id: 't', profileId: 'personal' }]);
  });

  it('does nothing on a fresh home', async () => {
    home = await mkdtemp(join(tmpdir(), 'accio-migrate-'));
    await expect(renameAccountsToProfiles(home)).resolves.toBeUndefined();
  });
});
