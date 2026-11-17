import { useId, useState } from 'react';
import { useHubs } from '../app/connection';
import { Check, ChevronDown, Hub, Settings } from '../app/icons';
import { usePopoverMenu } from '../ui/usePopoverMenu';

/** Settings-sidebar card and menu naming the hub the settings below apply to; its menu switches hubs and opens this machine's saved hubs. */
export function HubSelector({ onManage }: { onManage: () => void }) {
  const { hubs, selectedId, select } = useHubs();
  const id = useId();
  const [open, setOpen] = useState(false);
  const { props, trigger, popover: menu } = usePopoverMenu({
    onToggle: setOpen,
    escapeToTrigger: true,
  });
  const current = hubs.find((h) => h.id === selectedId);
  if (!current) return null;
  const switchable = hubs.length > 1;

  const label = (hub: typeof current) => <>
    <span className="hub-switcher-icon"><Hub /></span>
    <span className="hub-switcher-text">
      <b>{hub.name}</b>
      <small><i className={`dot ${hub.status}`} />{hub.status === 'connected' ? 'Connected' : hub.status === 'connecting' ? 'Connecting' : 'Offline'}{hub.running ? ` · ${hub.running} running` : ''}</small>
    </span>
  </>;

  return <>
    <button type="button" ref={trigger} className="hub-switcher" popoverTarget={id}
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
    <div id={id} {...props} className="menu hub-menu" popover="auto" role="menu" aria-label="Choose hub">
      {switchable && <div className="menu-label">Switch hub</div>}
      {switchable && hubs.map((hub) => <button key={hub.id} type="button" className="menu-item" role="menuitemradio" aria-checked={hub.id === selectedId}
        onClick={() => {
          menu.current?.hidePopover();
          trigger.current?.focus();
          select(hub.id);
        }}>
        {label(hub)}
        {hub.id === selectedId && <Check />}
      </button>)}
      {switchable && <hr />}
      <button type="button" className="menu-item" role="menuitem"
        onClick={() => {
          menu.current?.hidePopover();
          onManage();
        }}>
        <Settings />
        Manage hubs
      </button>
    </div>
  </>;
}
