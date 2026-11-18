import { useEffect, useState, type MouseEvent } from 'react';
import { projectKey, type ProjectView } from '@accio/protocol';
import { emitAppEvent } from '../app/appEvents';
import { useAction } from '../app/useAction';
import { useSpaces } from '../spaces/spaces';
import { usePopoverMenu } from '../ui/usePopoverMenu';

/**
 * The thread header's project name: clicking it opens the project dashboard. Right-click (or
 * Shift+F10) opens a menu for its space's view (only for a project in a space), the thread's
 * folder in Explorer, or its settings. Explorer needs this desktop's own server; elsewhere it is
 * listed greyed out with the reason.
 */
export function ProjectCrumbMenu({ project, path }: { project: ProjectView; path?: string }) {
  const { error, run, clear } = useAction();
  const [at, setAt] = useState<{ x: number; y: number }>();
  const { props, popover: menu } = usePopoverMenu({
    placement: { width: 200, side: 'below', height: 160, gap: 0, margin: 8 },
    at,
    onToggle: (open) => { if (open) clear(); else setAt(undefined); },
  });
  useEffect(() => { if (at) menu.current?.showPopover(); }, [at, menu]);
  const space = useSpaces().spaceOf(projectKey(project));
  // Always listed; greyed out with the reason when this window can't open the folder.
  const cannotOpenFolder = !path ? 'This thread has no folder on this machine.'
    : window.accioDesktop?.serverOrigin !== window.location.origin ? 'Only the Accio desktop app on the machine with this folder can open it.'
    : undefined;
  const close = () => menu.current?.hidePopover();
  const openFolder = () => run(async () => {
    await window.accioDesktop!.openFolder(path!);
    close();
  });
  const onContextMenu = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    // Shift+F10 and the menu key report no pointer: open under the name instead.
    if (e.clientX === 0 && e.clientY === 0) {
      const rect = e.currentTarget.getBoundingClientRect();
      setAt({ x: rect.left, y: rect.bottom + 4 });
    } else setAt({ x: e.clientX, y: e.clientY });
  };
  const item = (label: string, run: () => void, disabled?: string) => (
    <button type="button" className="menu-item" role="menuitem" disabled={!!disabled} title={disabled} onClick={run}><span className="menu-text">{label}</span></button>
  );

  return <>
    <button type="button" className="thread-project-link" aria-haspopup="menu" title={path ? `${project.name} dashboard · ${path}` : `${project.name} dashboard`}
      onClick={() => emitAppEvent('project.dashboard', { id: project.id })} onContextMenu={onContextMenu}>
      {project.name}
    </button>
    <div {...props} className="menu project-crumb-menu" popover="auto" role="menu" aria-label={project.name}>
      {space && item('Space', () => { close(); emitAppEvent('space.open', { id: space.id }); })}
      {item('Open in Explorer', () => void openFolder(), cannotOpenFolder)}
      {item('Project settings', () => { close(); emitAppEvent('project.open', { id: project.id }); })}
      {error && <p className="error menu-error" role="alert">Could not open the folder: {error}</p>}
    </div>
  </>;
}
