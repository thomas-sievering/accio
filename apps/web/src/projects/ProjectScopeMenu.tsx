import { useRef } from 'react';
import type { ProjectView } from '@accio/protocol';
import { Check, ListFilter, Settings } from '../app/icons';
import { ProjectMark } from './ProjectMark';
import { useProjects } from './projects';

/**
 * The sidebar's project filter, in place of per-project folders (as in T3 Code):
 * narrows the thread list to one project, and opens a project's settings.
 */
export function ProjectScopeMenu(props: {
  scope: string;
  onScope: (projectId: string) => void;
  onOpenProject: (p: ProjectView) => void;
}) {
  const { visible } = useProjects();
  const menu = useRef<HTMLDivElement>(null);
  const scoped = visible.find((p) => p.id === props.scope);
  const pick = (projectId: string) => {
    props.onScope(projectId);
    menu.current?.hidePopover();
  };

  return (
    <>
      <button
        className={`side-icon${scoped ? ' on' : ''}`}
        popoverTarget="project-scope-menu"
        title={scoped ? `Showing ${scoped.name} only` : 'Filter threads by project'}
        aria-label="Filter threads by project"
      >
        <ListFilter />
      </button>
      <div className="menu" id="project-scope-menu" popover="auto" ref={menu} role="menu">
        <button className="menu-item" role="menuitemradio" aria-checked={!scoped} onClick={() => pick('')}>
          <span className="menu-text">All projects</span>
          {!scoped && <Check />}
        </button>
        {visible.length > 0 && <hr />}
        {visible.map((p) => (
          <div key={p.id} className="menu-item menu-split">
            <button
              className="menu-split-main"
              role="menuitemradio"
              aria-checked={p.id === props.scope}
              title={p.repoKey ?? undefined}
              onClick={() => pick(p.id)}
            >
              <ProjectMark id={p.id} />
              <span className="menu-text">{p.name}</span>
              {p.id === props.scope && <Check />}
            </button>
            <button
              className="row-action"
              title={`${p.name} settings`}
              aria-label={`${p.name} settings`}
              onClick={() => {
                menu.current?.hidePopover();
                props.onOpenProject(p);
              }}
            >
              <Settings />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
