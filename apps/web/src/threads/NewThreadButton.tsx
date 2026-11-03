import { useRef } from 'react';
import { useClient } from '../app/connection';
import { SquarePen } from '../app/icons';
import { useProjects } from '../projects/projects';
import { useThreads } from './threads';

/**
 * Starts a thread. With one checkout in reach (one project in scope, one checkout)
 * it starts there at once; otherwise it asks which project and checkout.
 */
export function NewThreadButton() {
  const client = useClient();
  const { select, projectScope } = useThreads();
  const { visible, checkoutsOf } = useProjects();
  const menu = useRef<HTMLDivElement>(null);
  const projects = projectScope ? visible.filter((p) => p.id === projectScope) : visible;
  const choices = projects.flatMap((p) => {
    const checkouts = checkoutsOf(p.id);
    return checkouts.map((c) => ({ id: c.id, name: p.name, folder: checkouts.length > 1 ? folderName(c.path) : undefined }));
  });

  const start = async (checkoutId: string) => {
    menu.current?.hidePopover();
    const thread = await client.call('threads.create', { checkoutId });
    select(thread.id);
  };

  if (choices.length <= 1) {
    return (
      <button
        className="side-icon"
        title="New thread"
        aria-label="New thread"
        disabled={choices.length === 0}
        onClick={() => choices[0] && start(choices[0].id)}
      >
        <SquarePen />
      </button>
    );
  }
  return (
    <>
      <button className="side-icon" title="New thread" aria-label="New thread" popoverTarget="new-thread-menu">
        <SquarePen />
      </button>
      <div className="menu" id="new-thread-menu" popover="auto" ref={menu} role="menu">
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

function folderName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
