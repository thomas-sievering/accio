import { useRef } from 'react';
import { SquarePen } from '../app/icons';
import { folderName } from '../projects/folderName';
import { useProjects } from '../projects/projects';
import { useThreads } from './threads';

/** The checkouts a new thread could start in: those of the scoped project, or of every visible one. */
export function useNewThreadChoices() {
  const { projectScope } = useThreads();
  const { visible, checkoutsOf } = useProjects();
  const projects = projectScope ? visible.filter((p) => p.id === projectScope) : visible;
  return projects.flatMap((p) => {
    const checkouts = checkoutsOf(p.id);
    return checkouts.map((c) => ({ id: c.id, name: p.name, folder: checkouts.length > 1 ? folderName(c.path) : undefined }));
  });
}

/**
 * Opens a new thread's draft. With one checkout in reach it opens there at once;
 * otherwise it asks which project and checkout. Nothing is created until you send.
 */
export function NewThreadButton({ className = 'side-icon', label }: { className?: string; label?: string }) {
  const { openDraft } = useThreads();
  const choices = useNewThreadChoices();
  const menu = useRef<HTMLDivElement>(null);
  const content = (
    <>
      <SquarePen />
      {label}
    </>
  );

  const start = (checkoutId: string) => {
    menu.current?.hidePopover();
    openDraft(checkoutId);
  };

  if (choices.length <= 1) {
    return (
      <button
        className={className}
        title="New thread"
        aria-label="New thread"
        disabled={choices.length === 0}
        onClick={() => choices[0] && start(choices[0].id)}
      >
        {content}
      </button>
    );
  }
  const id = `new-thread-menu${label ? '-labelled' : ''}`;
  return (
    <>
      <button className={className} title="New thread" aria-label="New thread" popoverTarget={id}>
        {content}
      </button>
      <div className="menu" id={id} popover="auto" ref={menu} role="menu">
        <div className="menu-label">New thread in</div>
        {choices.map((c) => (
          <button key={c.id} className="menu-item" role="menuitem" onClick={() => start(c.id)}>
            <span className="menu-text">
              <b>{c.name}</b>
              {c.folder && <small>{c.folder}</small>}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
