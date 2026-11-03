import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useHubs } from '../app/connection';
import { Check, ChevronDown, Hub } from '../app/icons';

/** Settings-sidebar card and menu naming the hub the settings below apply to. */
export function HubSelector() {
  const { hubs, selectedId, select } = useHubs();
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const current = hubs.find((h) => h.id === selectedId);
  if (!current) return null;
  const switchable = hubs.length > 1;

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      menu.current?.hidePopover();
      trigger.current?.focus();
      return;
    }
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % items.length
      : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : undefined;
    if (next !== undefined) {
      event.preventDefault();
      items[next]?.focus();
    }
  };
  const label = (hub: typeof current) => <>
    <span className="hub-switcher-icon"><Hub /></span>
    <span className="hub-switcher-text">
      <b>{hub.name}</b>
      <small><i className={`dot ${hub.status}`} />{hub.status === 'connected' ? 'Connected' : hub.status === 'connecting' ? 'Connecting' : 'Offline'}{hub.running ? ` · ${hub.running} running` : ''}</small>
    </span>
  </>;

  if (!switchable) return <div className="hub-switcher">{label(current)}</div>;
  return <>
    <button type="button" ref={trigger} className="hub-switcher switchable" popoverTarget={id}
      aria-label={`Hub: ${current.name}`} aria-haspopup="menu" aria-expanded={open} aria-controls={id}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (!open) trigger.current?.click();
        }
      }}>
      {label(current)}
      <ChevronDown />
    </button>
    <div id={id} ref={menu} className="menu hub-menu" popover="auto" role="menu" aria-label="Choose hub" onKeyDown={move}
      onToggle={(event) => {
        setOpen(event.newState === 'open');
        if (event.newState === 'open') menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
      }}>
      <div className="menu-label">Switch hub</div>
      {hubs.map((hub) => <button key={hub.id} type="button" className="menu-item" role="menuitemradio" aria-checked={hub.id === selectedId}
        onClick={() => {
          menu.current?.hidePopover();
          trigger.current?.focus();
          select(hub.id);
        }}>
        {label(hub)}
        {hub.id === selectedId && <Check />}
      </button>)}
    </div>
  </>;
}
