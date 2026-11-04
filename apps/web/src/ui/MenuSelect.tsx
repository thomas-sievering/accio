import { useId, useRef, useState } from 'react';
import { Check, ChevronDown } from '../app/icons';

export type MenuOption<T extends string> = { value: T; label: string; detail?: string; disabled?: boolean };

/**
 * A select drawn in the app's own menu, in place of the platform's option list.
 * `placeholder` shows on the trigger while no option matches `value`.
 */
export function MenuSelect<T extends string>({ label, value, options, onChange, disabled, placeholder, invalid, id: triggerId, className }: {
  label: string;
  value: T;
  options: MenuOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  placeholder?: string;
  invalid?: boolean;
  id?: string;
  className?: string;
}) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return <>
    <button type="button" id={triggerId} ref={trigger} className={`menu-select${className ? ` ${className}` : ''}`} popoverTarget={id} disabled={disabled}
      aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={id} aria-invalid={invalid || undefined}>
      <span className={current ? undefined : 'menu-select-placeholder'}>{current?.label ?? placeholder ?? value}</span>
      <ChevronDown />
    </button>
    <div id={id} ref={menu} className="menu menu-select-list" popover="auto" role="menu" aria-label={label}
      onToggle={(e) => {
        setOpen(e.newState === 'open');
        if (e.newState !== 'open') return;
        const items = menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)');
        const chosen = menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]') ?? items?.[0];
        chosen?.focus();
        chosen?.scrollIntoView({ block: 'nearest' });
      }}
      onKeyDown={(e) => {
        const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)'));
        const at = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === 'ArrowDown' ? (at + 1) % items.length : e.key === 'ArrowUp' ? (at - 1 + items.length) % items.length
          : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : undefined;
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); menu.current?.hidePopover(); trigger.current?.focus(); }
        else if (next !== undefined) { e.preventDefault(); items[next]?.focus(); }
      }}>
      {options.length === 0 && <p className="menu-select-empty">Nothing to choose</p>}
      {options.map((o) => (
        <button key={o.value} type="button" className="menu-item" role="menuitemradio" aria-checked={o.value === value} disabled={o.disabled}
          onClick={() => { menu.current?.hidePopover(); trigger.current?.focus(); if (o.value !== value) onChange(o.value); }}>
          <span className="menu-text">{o.detail ? <><b>{o.label}</b><small>{o.detail}</small></> : o.label}</span>
          {o.value === value && <Check />}
        </button>
      ))}
    </div>
  </>;
}
