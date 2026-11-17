import { useId } from 'react';
import { projectKey, type ProjectView } from '@accio/protocol';
import { emitAppEvent } from '../app/appEvents';
import { useAction } from '../app/useAction';
import { useSpaces } from '../spaces/spaces';
import { usePopoverMenu } from '../ui/usePopoverMenu';

/**
 * The thread header's project name: a menu to open the project dashboard, its space's view
 * (only for a project in a space), the thread's folder in Explorer, or its settings.
 * Explorer needs this desktop's own server.
 */
export function ProjectCrumbMenu({ project, path }: { project: ProjectView; path?: string }) {
  const id = useId();
  const { error, run, clear } = useAction();
  const { props, popover: menu } = usePopoverMenu({ onToggle: (open) => { if (open) clear(); } });
  const space = useSpaces().spaceOf(projectKey(project));
  const canOpenFolder = !!path && window.accioDesktop?.serverOrigin === window.location.origin;
  const close = () => menu.current?.hidePopover();
  const openFolder = () => run(async () => {
    await window.accioDesktop!.openFolder(path!);
    close();
  });
  const item = (label: string, run: () => void) => (
    <button type="button" className="menu-item" role="menuitem" onClick={run}><span className="menu-text">{label}</span></button>
  );

  return <>
    <button type="button" className="thread-project-link" popoverTarget={id} aria-haspopup="menu" title={path ? `${project.name} · ${path}` : project.name}>
      {project.name}
    </button>
    <div id={id} {...props} className="menu project-crumb-menu" popover="auto" role="menu" aria-label={project.name}>
      {item('Dashboard', () => { close(); emitAppEvent('project.dashboard', { id: project.id }); })}
      {space && item('Space', () => { close(); emitAppEvent('space.open', { id: space.id }); })}
      {canOpenFolder && item('Open in Explorer', () => void openFolder())}
      {item('Project settings', () => { close(); emitAppEvent('project.open', { id: project.id }); })}
      {error && <p className="error menu-error" role="alert">Could not open the folder: {error}</p>}
    </div>
  </>;
}
