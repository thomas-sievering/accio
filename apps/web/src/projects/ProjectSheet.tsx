import type { ProjectView } from '@accio/protocol';
import type { SettingsRoute } from '../app/Settings';
import { ProjectForm } from './ProjectForm';

/** A project's settings as a floating dialog, for the header chip and the Filter gear. Settings shows the same form as a page. */
export function ProjectSheet({ project, onClose, onOpenSettings }: { project: ProjectView; onClose: () => void; onOpenSettings: (route: SettingsRoute) => void }) {
  return <ProjectForm project={project} mode="dialog" onClose={onClose} onOpenSettings={onOpenSettings} />;
}
