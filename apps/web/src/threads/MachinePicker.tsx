import { useId } from 'react';
import type { MachineView } from '@accio/protocol';
import { Check, Monitor } from '../app/icons';
import { usePopoverMenu } from '../ui/usePopoverMenu';

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
  const current = machines?.find((m) => m.id === value);
  const online = machines?.filter((m) => m.connected) ?? [];
  const label = !machines ? 'Loading machines…' : current ? current.name : 'Choose a machine';
  // Opens downward so the menu never covers the composer above it, unless the list won't fit.
  const { props, trigger, popover: menu } = usePopoverMenu({
    placement: { width: 260, side: 'below', height: 12 + Math.max(online.length, 1) * 40 },
  });

  return <>
    <button type="button" ref={trigger} className={`machine-trigger${current && !current.connected ? ' offline' : ''}`} popoverTarget={id}
      disabled={!machines} aria-haspopup="menu" aria-label={`Run on machine: ${label}`}>
      <Monitor />
      <span>{label}</span>
    </button>
    <div id={id} {...props} className="menu machine-menu" popover="auto" role="menu" aria-label="Run on machine">
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
