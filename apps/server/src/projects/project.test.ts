import { describe, expect, it } from 'vitest';
import { normalizeRemoteUrl, parseRemotes, repoKeyOf } from './repoIdentity.js';
import { addCheckout, removeCheckout, suggestProfile, type ProjectsData } from './project.js';

describe('repo identity', () => {
  it.each([
    ['https://github.com/Owner/Repo.git', 'github.com/owner/repo'],
    ['git@github.com:owner/repo.git', 'github.com/owner/repo'],
    ['ssh://git@github.com/owner/repo', 'github.com/owner/repo'],
    ['https://user@gitlab.example.com:8443/group/sub/repo/', 'gitlab.example.com/group/sub/repo'],
  ])('normalises %s', (url, key) => expect(normalizeRemoteUrl(url)).toBe(key));

  it.each(['file:///c/repos/x', 'C:\\repos\\x', '/srv/git/x.git', '../x'])('ignores local remote %s', (url) =>
    expect(normalizeRemoteUrl(url)).toBeNull(),
  );

  it('prefers origin, then upstream, then the first remote by name', () => {
    expect(
      repoKeyOf([
        { name: 'upstream', url: 'https://github.com/up/r' },
        { name: 'origin', url: 'https://github.com/me/r' },
      ]),
    ).toBe('github.com/me/r');
    expect(
      repoKeyOf([
        { name: 'zed', url: 'https://x.test/z' },
        { name: 'upstream', url: 'https://x.test/u' },
      ]),
    ).toBe('x.test/u');
    expect(
      repoKeyOf([
        { name: 'zed', url: 'https://x.test/z' },
        { name: 'alpha', url: 'https://x.test/a' },
      ]),
    ).toBe('x.test/a');
    expect(repoKeyOf([{ name: 'origin', url: 'C:\\local' }])).toBeNull();
  });

  it('parses git remote -v', () => {
    const out = 'origin\thttps://github.com/a/b (fetch)\norigin\thttps://github.com/a/b (push)\n';
    expect(parseRemotes(out)).toEqual([{ name: 'origin', url: 'https://github.com/a/b' }]);
  });
});

describe('suggestProfile', () => {
  const profiles = [
    { id: 'personal', roots: ['S:\\'] },
    { id: 'hrc', roots: ['S:\\hrc'] },
  ];
  it('picks the most specific folder', () => {
    expect(suggestProfile(profiles, 'S:\\hrc\\portal')).toBe('hrc');
    expect(suggestProfile(profiles, 's:/accio')).toBe('personal');
    expect(suggestProfile(profiles, 'S:\\hrcx')).toBe('personal');
    expect(suggestProfile(profiles, 'C:\\other')).toBeNull();
  });
});

describe('checkouts', () => {
  const empty: ProjectsData = { projects: [], checkouts: [] };

  it('creates a project for a new repo under the chosen profile', () => {
    const { data, checkout } = addCheckout(empty, { root: 'S:\\accio', repoKey: 'github.com/me/accio' }, 'personal');
    expect(data.projects).toEqual([expect.objectContaining({ name: 'accio', profileId: 'personal', repoKey: 'github.com/me/accio' })]);
    expect(checkout.projectId).toBe(data.projects[0]!.id);
  });

  it('joins a second checkout of the same repo to its project, keeping its profile', () => {
    const first = addCheckout(empty, { root: 'S:\\accio', repoKey: 'github.com/me/accio' }, 'personal').data;
    const { data } = addCheckout(first, { root: 'C:\\wt\\accio', repoKey: 'github.com/me/accio' }, 'hrc');
    expect(data.projects).toHaveLength(1);
    expect(data.projects[0]!.profileId).toBe('personal');
    expect(data.checkouts).toHaveLength(2);
  });

  it('keeps folders without a remote apart', () => {
    const first = addCheckout(empty, { root: 'S:\\a', repoKey: null }, 'personal').data;
    const { data } = addCheckout(first, { root: 'S:\\b', repoKey: null }, 'personal');
    expect(data.projects).toHaveLength(2);
  });

  it('refuses the same folder twice and a new project without a profile', () => {
    const first = addCheckout(empty, { root: 'S:\\a', repoKey: null }, 'personal').data;
    expect(() => addCheckout(first, { root: 's:/a/', repoKey: null }, 'personal')).toThrow(/already added/);
    expect(() => addCheckout(empty, { root: 'S:\\b', repoKey: null }, undefined)).toThrow(/profile/);
  });

  it('drops a project with its last checkout', () => {
    const one = addCheckout(empty, { root: 'S:\\a', repoKey: 'x.test/a' }, 'p');
    const two = addCheckout(one.data, { root: 'S:\\a2', repoKey: 'x.test/a' }, 'p');
    const afterFirst = removeCheckout(two.data, one.checkout.id);
    expect(afterFirst.projects).toHaveLength(1);
    expect(removeCheckout(afterFirst, two.checkout.id)).toEqual(empty);
  });
});
