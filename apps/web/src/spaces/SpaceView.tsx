import { useEffect, useRef } from 'react';
import { projectKey, threadPlace, type ProjectView, type Space } from '@accio/protocol';
import { emitAppEvent } from '../app/appEvents';
import { Close, MessageSquarePlus, Settings, Spaces as SpacesIcon } from '../app/icons';
import { useEscapeClose } from '../app/useEscapeClose';
import { useProfiles } from '../profiles/profiles';
import { MidPath } from '../projects/MidPath';
import { ProjectMark } from '../projects/ProjectMark';
import { useProjects } from '../projects/projects';
import { ThreadMenuProvider } from '../threads/ThreadMenu';
import { ThreadRow } from '../threads/ThreadRow';
import { useThreads } from '../threads/threads';

/**
 * GLOSSARY: Space, Home. Opened from a project name's menu or Settings / Spaces: the home
 * pinned on top, then every other project of the space with what needs you or is working
 * there. Threads still start from one project; this only gathers them.
 */
export function SpaceView({ space, onClose }: { space: Space; onClose: () => void }) {
  const heading = useRef<HTMLElement>(null);
  useEffect(() => { heading.current?.focus(); }, [space.id]);
  useEscapeClose(onClose);
  const others = space.projectKeys.filter((key) => key !== space.homeProjectKey);

  return (
    <>
      <header className="main-top drag">
        <div className="thread-title">
          <SpacesIcon />
          <b ref={heading} role="heading" aria-level={1} tabIndex={-1}>{space.name}</b>
        </div>
        <span className="spacer" />
        <button type="button" className="side-icon" title={`${space.name} settings`} aria-label={`${space.name} settings`}
          onClick={() => emitAppEvent('settings.open', { section: 'spaces', spaceId: space.id })}><Settings /></button>
        <button type="button" className="side-icon" title="Close (Esc)" aria-label="Close space" onClick={onClose}><Close /></button>
      </header>
      <div className="settings-scroll">
        <div className="dashboard-page space-page">
          <ThreadMenuProvider>
            {space.homeProjectKey && (
              <section className="dashboard-section" aria-label="Home">
                <h3 className="dashboard-heading">Home</h3>
                <SpaceProject projectKey={space.homeProjectKey} home />
              </section>
            )}
            <section className="dashboard-section" aria-label="Projects">
              <h3 className="dashboard-heading">Projects <span className="dashboard-count">{others.length}</span></h3>
              {others.length === 0
                ? <p className="dashboard-empty">{space.homeProjectKey ? 'No other projects yet.' : 'No projects yet.'} Add them in Settings / Spaces.</p>
                : <div className="space-projects-list">{others.map((key) => <SpaceProject key={key} projectKey={key} />)}</div>}
            </section>
          </ThreadMenuProvider>
        </div>
      </div>
    </>
  );
}

/**
 * One project of the space as this machine sees it: its profile, its checkout here, its threads
 * that need you or are working, and the ways into it. A project with no checkout here can only
 * be named, by its key.
 */
function SpaceProject({ projectKey: key, home = false }: { projectKey: string; home?: boolean }) {
  const { state, checkoutsOf } = useProjects();
  const { profiles = [] } = useProfiles();
  const { threads, now, openDraft } = useThreads();
  const project: ProjectView | undefined = state?.projects.find((p) => projectKey(p) === key);
  const checkout = project ? checkoutsOf(project.id)[0] : undefined;
  const name = project?.name ?? key.replace(/^local:/, '');
  const profile = project && profiles.find((p) => p.id === project.profileId)?.name;
  const active = project ? (threads ?? [])
    .filter((t) => t.projectId === project.id && !t.settledAt)
    .map((t) => ({ thread: t, place: threadPlace(t, now) }))
    .filter(({ place }) => place === 'open' || place === 'working')
    // Needs you before working, newest first within each.
    .sort((a, b) => (a.place === b.place ? b.thread.updatedAt.localeCompare(a.thread.updatedAt) : a.place === 'open' ? -1 : 1)) : [];
  const newThread = home ? 'New thread in home' : 'New thread';
  return (
    <article className={`space-project${home ? ' home' : ''}`} aria-label={name}>
      <div className="space-project-head">
        {project ? <ProjectMark id={project.id} size={16} /> : <span className="no-project-mark" />}
        <span className="space-project-text">
          <b>{name}</b>
          <small>
            {profile && <span title={`Profile: ${profile}`}>{profile}</span>}
            {checkout
              ? <span className="space-checkout"><MidPath text={checkout.path} tail={24} /></span>
              : <span className="space-checkout missing">Not on this machine</span>}
          </small>
        </span>
        {project && (
          <button type="button" className="ghost" aria-label={`${name} dashboard`}
            onClick={() => emitAppEvent('project.dashboard', { id: project.id })}>Dashboard</button>
        )}
        <button type="button" className={`ghost with-icon${home ? ' primary' : ''}`} disabled={!checkout}
          aria-label={home ? newThread : `New thread in ${name}`}
          title={checkout ? `Start a thread in ${name}` : `${name} has no checkout on this machine`}
          onClick={() => checkout && openDraft(checkout.id)}><MessageSquarePlus />{newThread}</button>
      </div>
      {active.length > 0 && (
        <div className="rows dashboard-rows">
          {active.map(({ thread, place }) => <ThreadRow key={thread.id} thread={thread} place={place} withinProject />)}
        </div>
      )}
    </article>
  );
}
