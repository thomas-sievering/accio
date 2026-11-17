import { describe, expect, it } from 'vitest';
import { closePage, limitsPage, loadPage, pageUnderSettings, savedPage, settingsPage, THREAD_PAGE, type Page } from './page';

const dashboard: Page = { kind: 'dashboard', projectId: 'p1' };

describe('app page', () => {
  it('closes Settings opened over a page back to it, and from the thread back to the thread', () => {
    const over = settingsPage(dashboard, { section: 'projects', id: 'p1' });
    expect(pageUnderSettings(over)).toEqual(dashboard);
    expect(closePage(over)).toEqual(dashboard);
    expect(closePage(settingsPage(THREAD_PAGE, { section: 'accounts' }))).toEqual(THREAD_PAGE);
  });

  it('keeps where Settings return to across a route change inside them', () => {
    const limits: Page = { kind: 'limits', scope: 'all' };
    const moved = settingsPage(settingsPage(limits, { section: 'accounts', id: 'a1' }), { section: 'profiles' });
    expect(moved).toEqual({ kind: 'settings', route: { section: 'profiles' }, back: limits });
  });

  it('returns Limits opened from Settings to the same Settings route', () => {
    const settings = settingsPage(THREAD_PAGE, { section: 'accounts', id: 'a1' });
    expect(closePage(limitsPage(settings, 'p1'))).toEqual(settings);
    expect(closePage(limitsPage(dashboard, 'p1'))).toEqual(THREAD_PAGE);
    // Limits replace what those Settings returned to: Back from them then leads to the thread.
    const overLimits = settingsPage({ kind: 'limits', scope: 'all' }, { section: 'accounts' });
    expect(closePage(closePage(limitsPage(overLimits, 'all')))).toEqual(THREAD_PAGE);
  });

  it('restores the saved page, Settings at their section', () => {
    const page = settingsPage(limitsPage(settingsPage(THREAD_PAGE, { section: 'accounts', id: 'a1' }), 'all'), { section: 'profiles', id: 'x' });
    const restored = loadPage(JSON.stringify(savedPage(page)));
    expect(restored).toEqual({ kind: 'settings', route: { section: 'profiles' }, back: { kind: 'limits', scope: 'all', back: { kind: 'settings', route: { section: 'accounts' } } } });
    for (const p of [dashboard, { kind: 'space', spaceId: 's1' } as Page, THREAD_PAGE]) expect(loadPage(JSON.stringify(savedPage(p)))).toEqual(p);
  });

  it('opens the thread surface for anything unreadable', () => {
    for (const raw of [null, '', '{', '{}', '{"kind":"dashboard"}', '{"settings":"accounts"}']) expect(loadPage(raw)).toEqual(THREAD_PAGE);
  });
});
