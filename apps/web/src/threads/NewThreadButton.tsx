import { useId, useRef, useState } from 'react';
import { ArrowLeft, Chevron, SquarePen } from '../app/icons';
import { useProfiles } from '../profiles/profiles';
import { folderName } from '../projects/folderName';
import { ProjectMark } from '../projects/ProjectMark';
import { useProjects } from '../projects/projects';
import { useThreads } from './threads';

/** Searchable project picker; No project is always the first choice. */
export function NewThreadButton({ className = 'side-icon', label }: { className?: string; label?: string }) {
  const { openDraft, setProjectScope } = useThreads();
  const { visible, checkoutsOf } = useProjects();
  const { profiles = [], filter } = useProfiles();
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const id = useId();
  const [query, setQuery] = useState('');
  const [step, setStep] = useState('');
  const [active, setActive] = useState(0);
  const availableProfiles = profiles.filter((p) => filter === 'all' || p.id === filter);
  const start = (checkoutId: string, profileId?: string) => {
    menu.current?.hidePopover();
    setProjectScope('');
    openDraft(checkoutId, profileId);
  };
  const go = (next: string) => {
    setStep(next); setQuery(''); setActive(0);
    search.current?.focus();
  };
  type Choice = { id: string; name: string; detail?: string; projectId?: string; next?: boolean; disabled?: boolean; pick: () => void };
  const project = visible.find((p) => p.id === step);
  const choices: Choice[] = step === 'profiles'
    ? availableProfiles.map((p) => ({ id: p.id, name: p.name, pick: () => start('', p.id) }))
    : project
      ? checkoutsOf(project.id).map((c) => ({ id: c.id, name: folderName(c.path), detail: c.path, projectId: project.id, pick: () => start(c.id) }))
      : visible.map((p) => {
        const checkouts = checkoutsOf(p.id);
        return {
          id: p.id, name: p.name, detail: checkouts[0]?.path, projectId: p.id,
          next: checkouts.length > 1, disabled: checkouts.length === 0,
          pick: () => checkouts.length === 1 ? start(checkouts[0]!.id) : go(p.id),
        };
      });
  const q = query.trim().toLowerCase();
  const filtered = choices.filter((c) => `${c.name} ${c.detail ?? ''}`.toLowerCase().includes(q));
  if (!step) filtered.unshift({
    id: 'no-project', name: 'No project', disabled: availableProfiles.length === 0,
    pick: () => availableProfiles.length === 1 ? start('', availableProfiles[0]!.id) : go('profiles'),
  });
  const selected = Math.min(active, Math.max(0, filtered.length - 1));
  return (
    <>
      <button className={className} title="New thread" aria-label="New thread" popoverTarget={id}>
        <SquarePen />{label}
      </button>
      <div className="new-thread-picker" id={id} popover="auto" ref={menu}
        onToggle={(e) => { if (e.newState === 'open') go(''); }}>
        <div className="picker-search">
          <button aria-label={step ? 'Back to projects' : 'Close'} onClick={() => step ? go('') : menu.current?.hidePopover()}><ArrowLeft /></button>
          <input ref={search} autoFocus placeholder="Search..." value={query} role="combobox"
            aria-label={step === 'profiles' ? 'Search profiles' : 'Search projects'} aria-expanded="true"
            aria-controls={`${id}-list`} aria-activedescendant={filtered.length ? `${id}-option-${selected}` : undefined}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((selected + (e.key === 'ArrowDown' ? 1 : -1) + filtered.length) % (filtered.length || 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (!filtered[selected]?.disabled) filtered[selected]?.pick();
              } else if (e.key === 'Backspace' && !query && step) {
                e.preventDefault(); go('');
              }
            }} />
        </div>
        <div className="picker-label">{step === 'profiles' ? 'Profile for No project' : project ? project.name : 'Projects'}</div>
        <div className="picker-options" role="listbox" id={`${id}-list`} aria-label="New thread location">
          {filtered.map((c, index) => (
            <button key={c.id} id={`${id}-option-${index}`} className="picker-option" role="option"
              aria-selected={index === selected} disabled={c.disabled} tabIndex={-1}
              ref={(node) => { if (index === selected) node?.scrollIntoView({ block: 'nearest' }); }}
              onMouseMove={() => setActive(index)} onClick={c.pick}>
              {c.projectId ? <ProjectMark id={c.projectId} size={16} /> : <span className="no-project-mark" />}
              <span className="menu-text"><b>{c.name}</b>{c.detail && <small>{c.detail}</small>}</span>
              {c.next && <Chevron />}
            </button>
          ))}
          {filtered.length === 0 && <p className="picker-empty">No matches found.</p>}
        </div>
        <div className="picker-footer">
          <span><kbd>↑</kbd> <kbd>↓</kbd> Navigate</span>
          <span><kbd>Enter</kbd> Select</span>
          {step && <span><kbd>Backspace</kbd> Back</span>}
          <span><kbd>Esc</kbd> Close</span>
        </div>
      </div>
    </>
  );
}
