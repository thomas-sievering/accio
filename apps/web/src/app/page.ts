import type { LimitsScope } from '../limits/limitsModel';
import type { SettingsRoute } from './Settings';

/**
 * The one page the app shell shows. The thread surface (the open thread or draft) stays mounted
 * under every other page, so opening one replaces the last without closing anything by hand.
 * `back` is where closing the page returns: Settings opened over Limits, a dashboard or a space
 * view goes back to it, and Limits opened from Settings goes back to the same Settings route.
 */
export type Page =
  | { kind: 'thread' }
  | { kind: 'settings'; route: SettingsRoute; back?: Page }
  | { kind: 'limits'; scope: LimitsScope; back?: Page }
  | { kind: 'dashboard'; projectId: string }
  | { kind: 'space'; spaceId: string };

export const THREAD_PAGE: Page = { kind: 'thread' };

/** Settings at `route`. A route change inside Settings keeps where it returns to. */
export function settingsPage(current: Page, route: SettingsRoute): Page {
  if (current.kind === 'settings') return { ...current, route };
  return current.kind === 'thread' ? { kind: 'settings', route } : { kind: 'settings', route, back: current };
}

/**
 * Limits at `scope`. Opened from Settings, closing it returns to the same route; the page
 * those Settings returned to is replaced, so Back from them then leads to the thread.
 */
export function limitsPage(current: Page, scope: LimitsScope): Page {
  return current.kind === 'settings' ? { kind: 'limits', scope, back: { kind: 'settings', route: current.route } } : { kind: 'limits', scope };
}

/** Where closing `page` leads. */
export function closePage(page: Page): Page {
  return (page.kind === 'settings' || page.kind === 'limits') && page.back ? page.back : THREAD_PAGE;
}

/** The page shown in the main pane: under Settings, the one it returns to. */
export function pageUnderSettings(page: Page): Exclude<Page, { kind: 'settings' }> {
  let under = page;
  while (under.kind === 'settings') under = under.back ?? THREAD_PAGE;
  return under;
}

/** What is remembered across restarts. Settings reopen on their section, not on one item. */
export function savedPage(page: Page): Page {
  switch (page.kind) {
    case 'settings': return { kind: 'settings', route: { section: page.route.section } as SettingsRoute, ...(page.back ? { back: savedPage(page.back) } : {}) };
    case 'limits': return { kind: 'limits', scope: page.scope, ...(page.back ? { back: savedPage(page.back) } : {}) };
    default: return page;
  }
}

/** Reads a remembered page; anything unreadable opens the thread surface. Ids that no longer exist fall back when rendered. */
export function loadPage(raw: string | null): Page {
  try {
    return readPage(JSON.parse(raw ?? 'null')) ?? THREAD_PAGE;
  } catch {
    return THREAD_PAGE;
  }
}

function readPage(value: unknown): Page | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  const back = v.back === undefined ? undefined : readPage(v.back);
  switch (v.kind) {
    case 'thread': return THREAD_PAGE;
    case 'settings': {
      const route = v.route as { section?: unknown } | undefined;
      return typeof route?.section === 'string' ? { kind: 'settings', route: { section: route.section } as SettingsRoute, ...(back ? { back } : {}) } : undefined;
    }
    case 'limits': return typeof v.scope === 'string' ? { kind: 'limits', scope: v.scope, ...(back ? { back } : {}) } : undefined;
    case 'dashboard': return typeof v.projectId === 'string' ? { kind: 'dashboard', projectId: v.projectId } : undefined;
    case 'space': return typeof v.spaceId === 'string' ? { kind: 'space', spaceId: v.spaceId } : undefined;
    default: return undefined;
  }
}
