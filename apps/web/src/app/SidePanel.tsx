import { useState } from 'react';
import type { SkillContext } from '@accio/protocol';
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

/**
 * The right-hand side panel: what sits beside the open thread or draft.
 * Skills is its only tab so far; the tab strip leaves room for more.
 */
export function SidePanel() {
  const { threads, selectedId, draft } = useThreads();
  const thread = threads?.find((t) => t.id === selectedId);
  // A draft has no thread yet: its skills come from the checkout (or the profile, without one).
  const context: SkillContext | undefined = draft
    ? draft.checkoutId ? { checkoutId: draft.checkoutId, ...(draft.profileId ? { profileId: draft.profileId } : {}) } : draft.profileId ? { profileId: draft.profileId } : undefined
    : thread ? { threadId: thread.id } : undefined;
  const key = context ? JSON.stringify(context) : '';
  return <>
    <PanelResizer />
    <aside className="side-panel" aria-label="Side panel">
      <header className="side-panel-top drag">
        <div className="side-panel-tabs" role="tablist" aria-label="Side panel">
          <button type="button" role="tab" id="side-tab-skills" aria-selected="true" aria-controls="side-tabpanel-skills" className="side-panel-tab">Skills</button>
        </div>
      </header>
      <div role="tabpanel" id="side-tabpanel-skills" aria-labelledby="side-tab-skills" className="side-panel-body">
        {context
          ? <SkillsPanel key={key} context={context} composer={draft ? 'draft' : thread!.id} />
          : <p className="side-panel-empty">Open a thread or start one to see its skills.</p>}
      </div>
    </aside>
  </>;
}
