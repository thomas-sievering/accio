import { useRef, useState } from 'react';
import type { SkillContext } from '@accio/protocol';
import { McpPanel } from '../mcp/McpPanel';
import { useProjects } from '../projects/projects';
import { SkillsPanel } from '../skills/SkillsPanel';
import { useThreads } from '../threads/threads';
import { PanelRight } from './icons';
import { PanelResizer } from './Resizer';

const KEY = 'accio.panelOpen';

/** Whether the right-hand side panel is open; remembered across launches. */
export function usePanelOpen() {
  const [open, setOpen] = useState(() => localStorage.getItem(KEY) === '1');
  const toggle = () => setOpen((was) => { localStorage.setItem(KEY, was ? '0' : '1'); return !was; });
  return [open, toggle] as const;
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

const TABS = [{ id: 'skills', label: 'Skills' }, { id: 'mcp', label: 'MCP' }] as const;
type Tab = (typeof TABS)[number]['id'];
const TAB_KEY = 'accio.panelTab';

/**
 * The right-hand side panel: what sits beside the open thread or draft, one tab
 * at a time. The tab strip sits under the caption row, clear of its buttons.
 */
export function SidePanel() {
  const { threads, selectedId, draft } = useThreads();
  const { state: projects } = useProjects();
  const [tab, setTab] = useState<Tab>(() => (localStorage.getItem(TAB_KEY) === 'mcp' ? 'mcp' : 'skills'));
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const thread = threads?.find((t) => t.id === selectedId);
  // A draft has no thread yet: its skills come from the checkout (or the profile, without one).
  const context: SkillContext | undefined = draft
    ? draft.checkoutId ? { checkoutId: draft.checkoutId, ...(draft.profileId ? { profileId: draft.profileId } : {}) } : draft.profileId ? { profileId: draft.profileId } : undefined
    : thread ? { threadId: thread.id } : undefined;
  const draftProjectId = draft?.checkoutId ? projects?.checkouts.find((c) => c.id === draft.checkoutId)?.projectId : undefined;
  const projectId = draft ? draftProjectId : thread?.projectId || undefined;
  const profileId = draft ? draft.profileId ?? projects?.projects.find((p) => p.id === draftProjectId)?.profileId : thread?.profileId;
  const key = context ? JSON.stringify(context) : '';
  const select = (next: Tab, focus = false) => {
    setTab(next);
    localStorage.setItem(TAB_KEY, next);
    if (focus) tabRefs.current[next]?.focus();
  };
  return <>
    <PanelResizer />
    <aside className="side-panel" aria-label="Side panel">
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
            className="side-panel-tab" onClick={() => select(t.id)}>{t.label}</button>
        ))}
      </div>
      <div role="tabpanel" id={`side-tabpanel-${tab}`} aria-labelledby={`side-tab-${tab}`} className="side-panel-body">
        {!context
          ? <p className="side-panel-empty">Open a thread or start one to see its {tab === 'mcp' ? 'MCP servers' : 'skills'}.</p>
          : tab === 'skills'
            ? <SkillsPanel key={key} context={context} composer={draft ? 'draft' : thread!.id} />
            : <McpPanel key={key} profileId={profileId} projectId={projectId} />}
      </div>
    </aside>
  </>;
}
