import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SkillContext } from '@accio/protocol';
import { McpPanel } from '../mcp/McpPanel';
import { DeliveryPanel, deliveryNeedsYou } from '../threads/DeliveryPanel';
import { SkillsPanel } from '../skills/SkillsPanel';
import { useThreads } from '../threads/threads';
import { useAppEvent } from './appEvents';
import { PanelRight } from './icons';
import { PanelResizer } from './Resizer';
import { useThreadAvailability } from '../threads/useThreadAvailability';

const KEY = 'accio.panelOpen';
const TAB_KEY = 'accio.panelTab';

/** Whether the right-hand side panel is open; remembered across launches. */
export function usePanelOpen() {
  const [open, setOpen] = useState(() => localStorage.getItem(KEY) === '1');
  const toggle = () => setOpen((was) => { localStorage.setItem(KEY, was ? '0' : '1'); return !was; });
  // A request to show a tab opens the panel there; the panel itself also switches if already open.
  useAppEvent('panel.show', (tab) => {
    localStorage.setItem(TAB_KEY, tab);
    localStorage.setItem(KEY, '1');
    setOpen(true);
  });
  return [open, toggle] as const;
}

const NARROW = '(max-width: 1100px)';

/** Whether the window is narrow enough for the side panel to overlay the thread instead of splitting it. */
export function useNarrow() {
  return useSyncExternalStore(
    (notify) => { const q = window.matchMedia(NARROW); q.addEventListener('change', notify); return () => q.removeEventListener('change', notify); },
    () => window.matchMedia(NARROW).matches,
  );
}

/** Sits just left of the window's own caption buttons, whichever pane is showing. */
export function PanelToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button className="panel-toggle side-icon" aria-pressed={open} aria-label="Side panel"
      title={open ? 'Hide side panel' : 'Show side panel'} onClick={onToggle}>
      <PanelRight />
    </button>
  );
}

const TABS = [{ id: 'delivery', label: 'Delivery' }, { id: 'skills', label: 'Skills' }, { id: 'mcp', label: 'MCP' }] as const;
export type PanelTab = (typeof TABS)[number]['id'];
type Tab = PanelTab;
const storedTab = (): Tab => { const saved = localStorage.getItem(TAB_KEY); return TABS.some((t) => t.id === saved) ? saved as Tab : 'skills'; };

/**
 * The right-hand side panel: what sits beside the open thread or draft, one tab
 * at a time. The tab strip sits under the caption row, clear of its buttons.
 */
export function SidePanel({ overlay = false }: { overlay?: boolean }) {
  const { threads, selectedId, draft } = useThreads();
  const [tab, setTab] = useState<Tab>(storedTab);
  useAppEvent('panel.show', setTab);
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const panel = useRef<HTMLElement>(null);
  const thread = threads?.find((t) => t.id === selectedId);
  const { reason } = useThreadAvailability(thread);
  const skillsUnavailable = !draft && thread ? reason('threads.skills') : undefined;
  // A draft has no thread yet: its skills come from the checkout (or the profile, without one).
  const context: SkillContext | undefined = draft
    ? draft.checkoutId ? { checkoutId: draft.checkoutId, ...(draft.profileId ? { profileId: draft.profileId } : {}) } : draft.profileId ? { profileId: draft.profileId } : undefined
    : thread ? { threadId: thread.id } : undefined;
  const key = context ? JSON.stringify(context) : '';
  // An overlay takes focus with it when it opens.
  useEffect(() => {
    if (!overlay) return;
    tabRefs.current[tab]?.focus();
    const wrapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented || document.querySelector('dialog[open], :popover-open')) return;
      const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href], [tabindex]') ?? [])]
        .filter((el) => el.tabIndex >= 0 && !el.matches(':disabled') && !el.closest('[inert]') && el.getClientRects().length > 0);
      const toggle = panel.current?.closest('.layout')?.querySelector<HTMLElement>('.panel-toggle');
      if (toggle) controls.push(toggle);
      const at = controls.indexOf(document.activeElement as HTMLElement);
      if (at < 0 || (event.shiftKey ? at === 0 : at === controls.length - 1)) {
        event.preventDefault();
        (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
      }
    };
    document.addEventListener('keydown', wrapFocus);
    return () => document.removeEventListener('keydown', wrapFocus);
  }, [overlay]); // The active tab is focused only when entering the overlay.
  const select = (next: Tab, focus = false) => {
    setTab(next);
    localStorage.setItem(TAB_KEY, next);
    if (focus) tabRefs.current[next]?.focus();
  };
  return <>
    <PanelResizer />
    <aside ref={panel} className="side-panel" aria-label="Side panel">
      <header className="side-panel-top drag" />
      <div className="side-panel-tabs" role="tablist" aria-label="Side panel"
        onKeyDown={(e) => {
          const at = TABS.findIndex((t) => t.id === tab);
          const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
          if (step) { e.preventDefault(); select(TABS[(at + step + TABS.length) % TABS.length]!.id, true); }
        }}>
        {TABS.map((t) => (
          <button key={t.id} ref={(el) => { tabRefs.current[t.id] = el; }} type="button" role="tab" id={`side-tab-${t.id}`}
            aria-selected={tab === t.id} aria-controls={`side-tabpanel-${t.id}`} tabIndex={tab === t.id ? 0 : -1}
            className="side-panel-tab" onClick={() => select(t.id)}>
            {t.label}{t.id === 'delivery' && deliveryNeedsYou(thread) && <span className="tab-dot" aria-label="needs attention" />}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`side-tabpanel-${tab}`} aria-labelledby={`side-tab-${tab}`} className="side-panel-body">
        {tab === 'delivery'
          ? thread && !draft ? <DeliveryPanel thread={thread} /> : <p className="side-panel-empty">Open a thread to follow its delivery.</p>
          : !context
          ? <p className="side-panel-empty">Open a thread or start one to see its {tab === 'mcp' ? 'MCP servers' : 'skills'}.</p>
          : tab === 'skills'
            ? skillsUnavailable ? <p className="side-panel-empty">{skillsUnavailable}</p> : <SkillsPanel key={key} context={context} composer={draft ? 'draft' : thread!.id} />
            : <McpPanel />}
      </div>
    </aside>
  </>;
}
