import { useRef } from 'react';
import type { ProjectView } from '@accio/protocol';
import { useProfiles } from '../profiles/profiles';
import { ProjectMark } from '../projects/ProjectMark';
import { useProjects } from '../projects/projects';
import { useThreads } from '../threads/threads';
import { Check, Layers, ListFilter, Settings, User } from './icons';

/**
 * Filter the thread list by profile or project without changing the open thread.
 * Projects sit under their profile, with a shortcut to each project's settings.
 */
export function ScopeMenu({ onOpenProject }: { onOpenProject: (p: ProjectView) => void }) {
  const { profiles = [], filter, setFilter } = useProfiles();
  const { state } = useProjects();
  const { projectScope, setProjectScope } = useThreads();
  const menu = useRef<HTMLDivElement>(null);
  const projects = [...(state?.projects ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const active = filter !== 'all' || projectScope !== '';

  const pick = (profileId: string, projectId = '') => {
    setFilter(profileId);
    setProjectScope(projectId);
    menu.current?.hidePopover();
  };
  const checked = (profileId: string, projectId = '') =>
    projectScope === projectId && filter === profileId;

  return (
    <>
      <button className={`side-icon thread-filter${active ? ' on' : ''}`} popoverTarget="scope-menu" title="Filter threads" aria-label="Filter threads" aria-haspopup="menu">
        <ListFilter />
        {active && <span className="filter-dot" />}
      </button>
      <div className="menu scope-menu" id="scope-menu" popover="auto" ref={menu} role="menu">
        <div className="menu-label">Filter threads</div>
        <button className="menu-item" role="menuitemradio" aria-checked={checked('all')} onClick={() => pick('all')}>
          <span className="menu-icon"><Layers /></span>
          <span className="menu-text">
            <b>All threads</b>
            <small>All profiles and projects</small>
          </span>
          {checked('all') && <Check />}
        </button>
        <hr />
        {profiles.map((profile) => (
          <div key={profile.id} className="scope-group">
            <button className="menu-item" role="menuitemradio" aria-checked={checked(profile.id)} onClick={() => pick(profile.id)}>
              <span className="menu-icon"><User /></span>
              <span className="menu-text">
                <b>{profile.name}</b>
              </span>
              {checked(profile.id) && <Check />}
            </button>
            {projects
              .filter((p) => p.profileId === profile.id)
              .map((p) => (
                <div key={p.id} className="menu-item menu-split scope-project">
                  <button
                    className="menu-split-main"
                    role="menuitemradio"
                    aria-checked={checked(profile.id, p.id)}
                    title={p.repoKey ?? undefined}
                    onClick={() => pick(profile.id, p.id)}
                  >
                    <ProjectMark id={p.id} size={16} />
                    <span className="menu-text">{p.name}</span>
                    {checked(profile.id, p.id) && <Check />}
                  </button>
                  <button
                    className="row-action"
                    title={`${p.name} settings`}
                    aria-label={`${p.name} settings`}
                    onClick={() => {
                      menu.current?.hidePopover();
                      onOpenProject(p);
                    }}
                  >
                    <Settings />
                  </button>
                </div>
              ))}
          </div>
        ))}
      </div>
    </>
  );
}
