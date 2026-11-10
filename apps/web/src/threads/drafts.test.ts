import { beforeAll, describe, expect, it, vi } from 'vitest';

const saved = new Map<string, string>([
  ['accio:h1:composer:new:c1:', 'before restart'],
  ['accio:h1:composer:new::a1:pastes', '["long paste"]'],
  ['accio:h1:composer:thread:t1', 'a reply'],
  ['accio:h2:composer:new:c9:', 'another hub'],
]);
let drafts: typeof import('./drafts');

beforeAll(async () => {
  vi.stubGlobal('localStorage', {
    get length() { return saved.size; },
    key: (i: number) => [...saved.keys()][i] ?? null,
    getItem: (k: string) => saved.get(k) ?? null,
    setItem: (k: string, v: string) => void saved.set(k, v),
    removeItem: (k: string) => void saved.delete(k),
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  drafts = await import('./drafts');
});

const listed = (hub = 'h1') => drafts.draftsOf(hub).map((d) => [d.checkoutId, d.profileId ?? null, d.text, d.pastes.length, d.images.length]);

describe('new-thread drafts', () => {
  it('lists drafts saved before a restart for this hub only, not thread composers', () => {
    expect(listed()).toEqual([['c1', null, 'before restart', 0, 0], ['', 'a1', '', 1, 0]]);
  });

  it('lists a draft once it has text or an image, and drops it when emptied', () => {
    const key = drafts.composerKey('h1', drafts.newThreadDraftId('c2'));
    drafts.editDraft(key, 'text', '   ');
    expect(listed()).toHaveLength(2);
    drafts.editDraft(key, 'images', [{ key: 'i', name: 'Pasted image', mimeType: 'image/png', url: 'blob:x' }]);
    expect(listed()).toContainEqual(['c2', null, '   ', 0, 1]);
    expect(saved.get(key)).toBe('   ');
    drafts.discardDraft(key);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x');
    expect(listed()).toHaveLength(2);
    expect(saved.has(key)).toBe(false);
  });

  it('saves Reactions beside the text and forgets them when emptied', () => {
    const key = drafts.composerKey('h1', 'thread:t1');
    drafts.editDraft(key, 'reactions', [{ kind: 'unclear', quote: 'the watcher' }]);
    expect(JSON.parse(saved.get(`${key}:reactions`)!)).toEqual([{ kind: 'unclear', quote: 'the watcher' }]);
    expect(listed()).toHaveLength(2);
    drafts.discardDraft(key);
    expect(saved.has(`${key}:reactions`)).toBe(false);
  });

  it('keeps the same list while nothing changes', () => {
    expect(drafts.draftsOf('h1')).toBe(drafts.draftsOf('h1'));
  });
});
