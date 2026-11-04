import { useState } from 'react';
import { useProfiles } from '../profiles/profiles';
import { SettingLink, SettingsSection } from '../app/Settings';
import { AddProjectSheet } from './AddProjectSheet';
import { ProjectForm } from './ProjectForm';
import { ProjectMark } from './ProjectMark';
import { useProjects } from './projects';
import type { SettingsRoute } from '../app/Settings';

/** Every project, each opening its settings as a detail page, and a row to add one. */
export function ProjectsSettings({ projectId, onOpen, onRoute }: { projectId?: string; onOpen: (id?: string) => void; onRoute: (route: SettingsRoute) => void }) {
  const { state, checkoutsOf } = useProjects();
  const { profiles = [] } = useProfiles();
  const [adding, setAdding] = useState(false);
  if (!state) return <p className="note" role="status">Loading projects…</p>;
  const projects = [...state.projects].sort((a, b) => a.name.localeCompare(b.name));
  const open = projects.find((p) => p.id === projectId);
  if (projectId && !open) return <><p className="note">This project no longer exists.</p><button type="button" className="link" onClick={() => onOpen(undefined)}>All projects</button></>;
  if (open) return <ProjectForm key={open.id} project={open} onClose={() => onOpen(undefined)} onOpenSettings={onRoute} />;
  return (
    <>
      <p className="note">Each project belongs to one profile.</p>
      <SettingsSection add={{ label: 'Add project', onClick: () => setAdding(true) }}>
        {projects.map((p) => {
          const checkouts = checkoutsOf(p.id).length;
          return (
            <SettingLink key={p.id} icon={<ProjectMark id={p.id} size={20} />} title={p.name}
              description={[profiles.find((a) => a.id === p.profileId)?.name, `${checkouts} checkout${checkouts === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
              onClick={() => onOpen(p.id)} />
          );
        })}
      </SettingsSection>
      {adding && <AddProjectSheet onClose={() => setAdding(false)} />}
    </>
  );
}
