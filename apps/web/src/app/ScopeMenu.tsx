import { useRef } from 'react';
import type { ProjectView } from '@accio/protocol';
import { ProfileTile, useProfiles } from '../profiles/profiles';
import { ProjectMark } from '../projects/ProjectMark';
import { useProjects } from '../projects/projects';
import { useThreads } from '../threads/threads';
import { Check, FolderPlus, Settings, UpDown } from './icons';

/**
 * The top of the sidebar: one answer to "what am I looking at". Pick everything,
 * one profile, or one project (which also picks its profile). Projects sit under
 * their profile, each with its settings, and new projects are added here too.
 */
export function ScopeMenu({ onOpenProject, onAddProject }: { onOpenProject: (p: ProjectView) => void; onAddProject: () => void }) {
  const { profiles = [], filter, setFilter } = useProfiles();
  const { state } = useProjects();
  const { projectScope, setProjectScope } = useThreads();
  const menu = useRef<HTMLDivElement>(null);
  const projects = [...(state?.projects ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const scopedProject = projects.find((p) => p.id === projectScope);
  // With one profile, "all" and "that profile" are the same choice: show it as the profile.
  const single = profiles.length === 1 ? profiles[0] : undefined;
  const scopedProfile = profiles.find((p) => p.id === filter) ?? single;

  const pick = (profileId: string, projectId = '') => {
    setFilter(single ? 'all' : profileId);
    setProjectScope(projectId);
    menu.current?.hidePopover();
  };
  const checked = (profileId: string, projectId = '') =>
    projectScope === projectId && (projectId !== '' || filter === profileId || (single !== undefined && profileId === single.id));

  return (
    <>
      <button className="switcher" popoverTarget="scope-menu" title="Choose what the sidebar shows">
        {scopedProject ? (
          <span className="switcher-mark">
            <ProjectMark id={scopedProject.id} size={14} />
          </span>
        ) : (
          <ProfileTile profile={scopedProfile} />
        )}
        <span className="switcher-name">{scopedProject?.name ?? scopedProfile?.name ?? 'Everything'}</span>
        <span className="switcher-updown">
          <UpDown />
        </span>
      </button>
      <div className="menu scope-menu" id="scope-menu" popover="auto" ref={menu} role="menu">
        {!single && profiles.length > 0 && (
          <button className="menu-item" role="menuitemradio" aria-checked={checked('all')} onClick={() => pick('all')}>
            <ProfileTile size="md" />
            <span className="menu-text">
              <b>Everything</b>
              <small>All profiles and projects</small>
            </span>
            {checked('all') && <Check />}
          </button>
        )}
        {profiles.map((profile) => (
          <div key={profile.id} className="scope-group">
            <button className="menu-item" role="menuitemradio" aria-checked={checked(profile.id)} onClick={() => pick(profile.id)}>
              <ProfileTile profile={profile} size="md" />
              <span className="menu-text">
                <b>{profile.name}</b>
                <small className={profile.account ? undefined : 'warn'}>
                  {profile.account ? (profile.account.email ?? 'Signed in') : 'Not signed in'}
                </small>
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
                    <ProjectMark id={p.id} />
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
        {profiles.length > 0 && <hr />}
        <button
          className="menu-item"
          role="menuitem"
          disabled={profiles.length === 0}
          onClick={() => {
            menu.current?.hidePopover();
            onAddProject();
          }}
        >
          <span className="menu-icon">
            <FolderPlus />
          </span>
          <span className="menu-text">Add project…</span>
        </button>
      </div>
    </>
  );
}
