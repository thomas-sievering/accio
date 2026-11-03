import { useState } from 'react';
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

/** The right-hand side panel. Empty for now: the home for whatever sits beside a thread. */
export function SidePanel() {
  return <>
    <PanelResizer />
    <aside className="side-panel" aria-label="Side panel">
      <header className="side-panel-top drag" />
      <p className="side-panel-empty">Nothing here yet.</p>
    </aside>
  </>;
}
