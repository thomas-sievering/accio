import { useId, useRef, useState } from 'react';
import type { ProjectView } from '@accio/protocol';
import { emitAppEvent } from '../app/appEvents';
import { focusMenuItem, onMenuKeyDown } from '../ui/menuKeys';

/**
 * The thread header's project name: a menu to open the thread's folder in Explorer,
 * the project's Changelog, or its settings. Explorer needs this desktop's own server.
 */
export function ProjectCrumbMenu({ project, path }: { project: ProjectView; path?: string }) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();
  const canOpenFolder = !!path && window.accioDesktop?.serverOrigin === window.location.origin;
  const close = () => menu.current?.hidePopover();
  const openFolder = async () => {
    setError(undefined);
    try {
      await window.accioDesktop!.openFolder(path!);
      close();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const item = (label: string, run: () => void) => (
    <button type="button" className="menu-item" role="menuitem" onClick={run}><span className="menu-text">{label}</span></button>
  );

  return <>
    <button type="button" className="thread-project-link" popoverTarget={id} aria-haspopup="menu" title={path ? `${project.name} · ${path}` : project.name}>
      {project.name}
    </button>
    <div id={id} ref={menu} className="menu project-crumb-menu" popover="auto" role="menu" aria-label={project.name}
      onKeyDown={onMenuKeyDown}
      onToggle={(e) => { if (e.newState === 'open') { setError(undefined); focusMenuItem(menu.current); } }}>
      {canOpenFolder && item('Open in Explorer', () => void openFolder())}
      {item('Changelog', () => { close(); emitAppEvent('changelog.open', { projectId: project.id }); })}
      {item('Project settings', () => { close(); emitAppEvent('project.open', { id: project.id }); })}
      {error && <p className="error menu-error" role="alert">Could not open the folder: {error}</p>}
    </div>
  </>;
}
