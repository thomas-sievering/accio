import { useCallback, useState } from 'react';
import { MachineBadge } from '../machine/MachineBadge';
import { claudeAccount, ProfilesProvider, useProfiles } from '../profiles/profiles';
import { ProjectsProvider, useProjects } from '../projects/projects';
import { AddProjectSheet } from '../projects/AddProjectSheet';
import { ProjectSheet } from '../projects/ProjectSheet';
import { ThreadsProvider, useThreads } from '../threads/threads';
import { NewThreadButton, useNewThreadChoices } from '../threads/NewThreadButton';
import { ThreadList } from '../threads/ThreadList';
import { DraftPane, ThreadPane } from '../threads/ThreadPane';
import { ThreadSearch } from '../threads/ThreadSearch';
import { FirstRun } from './FirstRun';
import { Settings as Gear } from './icons';
import { ScopeMenu } from './ScopeMenu';
import { Settings, type SettingsRoute } from './Settings';

type OpenSheet = { kind: 'addProject' } | { kind: 'project'; id: string } | null;

export function App() {
  return (
    <ProfilesProvider>
      <ProjectsProvider>
        <ThreadsProvider>
          <Shell />
        </ThreadsProvider>
      </ProjectsProvider>
    </ProfilesProvider>
  );
}

/**
 * One way to each thing: the scope menu picks what the sidebar shows and adds
 * projects; the gear opens Settings (profiles, hub, machine); everything a
 * thread can do is on its right-click menu.
 */
function Shell() {
  const { profiles } = useProfiles();
  const { state } = useProjects();
  const { threads, selectedId, draft } = useThreads();
  const thread = threads?.find((t) => t.id === selectedId);
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const [settings, setSettings] = useState<SettingsRoute | null>(null);
  const closeSettings = useCallback(() => setSettings(null), []);
  const close = () => setSheet(null);
  const openProject = sheet?.kind === 'project' ? state?.projects.find((p) => p.id === sheet.id) : undefined;
  const openProfile = (profileId: string) => setSettings({ section: 'profiles', profileId });
  const setUp = profiles && state && profiles.length > 0 && profiles.some((p) => claudeAccount(p)?.signedIn) && state.projects.length > 0;

  if (settings) return <Settings route={settings} onRoute={setSettings} onClose={closeSettings} />;

  return (
    <div className="layout">
      <aside className="sidebar">
        <header className="side-top drag">
          <ScopeMenu onOpenProject={(p) => setSheet({ kind: 'project', id: p.id })} onAddProject={() => setSheet({ kind: 'addProject' })} />
        </header>
        <div className="side-tools">
          <ThreadSearch />
          <NewThreadButton />
        </div>
        <nav className="side-body">
          <ThreadList />
        </nav>
        <footer className="side-foot">
          <MachineBadge onOpen={() => setSettings({ section: 'machines' })} />
          <button className="side-icon" title="Settings" aria-label="Settings" onClick={() => setSettings({ section: 'profiles' })}>
            <Gear />
          </button>
        </footer>
      </aside>
      <main className="main">
        {draft ? (
          <DraftPane key={draft} checkoutId={draft} onOpenProfile={openProfile} />
        ) : thread ? (
          <ThreadPane key={thread.id} thread={thread} onOpenProfile={openProfile} />
        ) : (
          <>
            <header className="main-top drag" />
            {profiles && state && !setUp ? <FirstRun /> : <Idle />}
          </>
        )}
      </main>
      {sheet?.kind === 'addProject' && <AddProjectSheet onClose={close} />}
      {openProject && <ProjectSheet project={openProject} onClose={close} />}
    </div>
  );
}

function Idle() {
  const choices = useNewThreadChoices();
  return (
    <div className="empty">
      <p>Pick a thread, or start a new one.</p>
      {choices.length > 0 && <NewThreadButton className="ghost primary with-icon" label="New thread" />}
    </div>
  );
}
