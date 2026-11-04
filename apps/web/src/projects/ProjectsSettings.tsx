import { useProfiles } from '../profiles/profiles';
import { SettingLink, SettingRow, SettingsSection } from '../app/Settings';
import { ProjectMark } from './ProjectMark';
import { ProjectSheet } from './ProjectSheet';
import { useProjects } from './projects';
import type { SettingsRoute } from '../app/Settings';

/** Every project, each opening its settings. The sheet opens over the list, so closing it returns here. */
export function ProjectsSettings({ projectId, onOpen, onRoute }: { projectId?: string; onOpen: (id?: string) => void; onRoute: (route: SettingsRoute) => void }) {
  const { state, checkoutsOf } = useProjects();
  const { profiles = [] } = useProfiles();
  if (!state) return <p className="note" role="status">Loading projects…</p>;
  const projects = [...state.projects].sort((a, b) => a.name.localeCompare(b.name));
  const open = projects.find((p) => p.id === projectId);
  return (
    <>
      <p className="note">Each project belongs to one profile.</p>
      <SettingsSection>
        {projects.length === 0 && <SettingRow title="No projects yet" />}
        {projects.map((p) => {
          const checkouts = checkoutsOf(p.id).length;
          return (
            <SettingLink key={p.id} icon={<ProjectMark id={p.id} size={20} />} title={p.name}
              description={[profiles.length > 1 ? profiles.find((a) => a.id === p.profileId)?.name : undefined, `${checkouts} checkout${checkouts === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
              onClick={() => onOpen(p.id)} />
          );
        })}
      </SettingsSection>
      {open && <ProjectSheet project={open} onClose={() => onOpen(undefined)} onOpenSettings={onRoute} />}
    </>
  );
}
