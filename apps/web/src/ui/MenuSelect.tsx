import { useId, useState } from 'react';
import { Check, ChevronDown } from '../app/icons';
import { usePopoverMenu } from './usePopoverMenu';

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
  const [open, setOpen] = useState(false);
  const { props, trigger, popover: menu } = usePopoverMenu({
    onToggle: setOpen,
    escapeToTrigger: true,
  });
  const current = options.find((o) => o.value === value);
  return <>
    <button type="button" id={triggerId} ref={trigger} className={`menu-select${className ? ` ${className}` : ''}`} popoverTarget={id} disabled={disabled}
      aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={id} aria-invalid={invalid || undefined}>
      <span className={current ? undefined : 'menu-select-placeholder'}>{current?.label ?? placeholder ?? value}</span>
      <ChevronDown />
    </button>
    <div id={id} {...props} className="menu menu-select-list" popover="auto" role="menu" aria-label={label}>
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
