import { useState } from 'react';
import type { ProjectView } from '@accio/protocol';
import { useProfiles } from '../profiles/profiles';
import { SettingLink, SettingsSection, type SettingsNav } from '../app/Settings';
import { AddProjectSheet } from './AddProjectSheet';
import { ProjectForm } from './ProjectForm';
import { ProjectMark } from './ProjectMark';
import { useProjects } from './projects';

export function useProjectsData() {
  return { items: useProjects().state?.projects };
}
type Props = { nav: SettingsNav; data: ReturnType<typeof useProjectsData> };

/** Opened from the project dashboard, Save and Cancel return to it. */
export function ProjectDetail({ nav, item }: Props & { item: ProjectView }) {
  return <ProjectForm project={item} onClose={nav.route.extra?.fromDashboard ? nav.close : nav.back} onOpenSettings={nav.navigate} />;
}

/** Every project, each opening its settings as a detail page, and a row to add one. */
export function ProjectsList({ nav, data }: Props) {
  const { checkoutsOf } = useProjects();
  const { profiles = [] } = useProfiles();
  const [adding, setAdding] = useState(false);
  const projects = [...data.items!].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <p className="note">Each project belongs to one profile.</p>
      <SettingsSection add={{ label: 'Add project', onClick: () => setAdding(true) }}>
        {projects.map((p) => {
          const checkouts = checkoutsOf(p.id).length;
          return (
            <SettingLink key={p.id} icon={<ProjectMark id={p.id} size={20} />} title={p.name}
              description={[profiles.find((a) => a.id === p.profileId)?.name, `${checkouts} checkout${checkouts === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
              onClick={() => nav.open(p.id)} />
          );
        })}
      </SettingsSection>
      {adding && <AddProjectSheet onClose={() => setAdding(false)} />}
    </>
  );
}
