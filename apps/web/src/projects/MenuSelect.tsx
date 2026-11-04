import { useId, useRef, useState } from 'react';
import { Check, ChevronDown } from '../app/icons';

/** A select drawn in the app's own menu, in place of the platform's option list. */
export function MenuSelect<T extends string>({ label, value, options, onChange, disabled }: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return <>
    <button type="button" ref={trigger} className="menu-select" popoverTarget={id} disabled={disabled}
      aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={id}>
      <span>{current?.label ?? value}</span>
      <ChevronDown />
    </button>
    <div id={id} ref={menu} className="menu menu-select-list" popover="auto" role="menu" aria-label={label}
      onToggle={(e) => {
        setOpen(e.newState === 'open');
        if (e.newState === 'open') menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
      }}
      onKeyDown={(e) => {
        const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
        const at = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === 'ArrowDown' ? (at + 1) % items.length : e.key === 'ArrowUp' ? (at - 1 + items.length) % items.length : undefined;
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); menu.current?.hidePopover(); trigger.current?.focus(); }
        else if (next !== undefined) { e.preventDefault(); items[next]?.focus(); }
      }}>
      {options.map((o) => (
        <button key={o.value} type="button" className="menu-item" role="menuitemradio" aria-checked={o.value === value}
          onClick={() => { menu.current?.hidePopover(); trigger.current?.focus(); onChange(o.value); }}>
          <span className="menu-text">{o.label}</span>
          {o.value === value && <Check />}
        </button>
      ))}
    </div>
  </>;
}
