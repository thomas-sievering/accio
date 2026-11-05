import { useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { MachineView } from '@accio/protocol';
import { Check, Monitor } from '../app/icons';

/**
 * GLOSSARY: Machine. A quiet chip naming where a new thread will run; clicking lists the
 * online machines, the current one ticked, each with an optional note.
 */
export function MachinePicker({ machines, value, onChange, note }: {
  machines?: MachineView[];
  value?: string;
  onChange: (machineId: string) => void;
  /** A second line under a machine's name, such as that sending will clone the project there. */
  note?: (machine: MachineView) => string | undefined;
}) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  const current = machines?.find((m) => m.id === value);
  const online = machines?.filter((m) => m.connected) ?? [];
  const label = !machines ? 'Loading machines…' : current ? current.name : 'Choose a machine';

  const move = (event: KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])];
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  return <>
    <button type="button" ref={trigger} className={`machine-trigger${current && !current.connected ? ' offline' : ''}`} popoverTarget={id}
      disabled={!machines} aria-haspopup="menu" aria-label={`Run on machine: ${label}`}
      title={current && !current.connected ? `${current.name} is offline` : undefined}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const width = Math.min(260, window.innerWidth - 24);
        // Open downward so the menu never covers the composer above it, unless the list won't fit.
        const below = window.innerHeight - rect.bottom >= Math.min(rect.top, 12 + Math.max(online.length, 1) * 40);
        setPosition({ width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
          ...(below ? { top: rect.bottom + 6, bottom: 'auto' } : { bottom: window.innerHeight - rect.top + 6, top: 'auto' }) });
      }}>
      <Monitor />
      <span>{label}</span>
    </button>
    <div id={id} ref={menu} className="menu machine-menu" popover="auto" role="menu" aria-label="Run on machine" style={position} onKeyDown={move}
      onToggle={(event) => {
        if (event.newState !== 'open') return;
        requestAnimationFrame(() => (menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
          ?? menu.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]'))?.focus());
      }}>
      {online.length === 0 && <p className="machine-menu-empty">No machines are online.</p>}
      {online.map((m) => <button key={m.id} type="button" className="menu-item" role="menuitemradio" aria-checked={m.id === value}
        onClick={() => { menu.current?.hidePopover(); trigger.current?.focus(); onChange(m.id); }}>
        <Monitor />
        <span className="menu-text"><b>{m.name}</b>{m.thisMachine ? <small>This machine</small> : note?.(m) && <small>{note(m)}</small>}</span>
        <span className="machine-check" aria-hidden>{m.id === value && <Check />}</span>
      </button>)}
    </div>
  </>;
}
