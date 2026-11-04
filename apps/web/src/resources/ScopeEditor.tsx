import type { ResourceScope } from '@accio/protocol';
import { useProfiles } from '../profiles/profiles';
import { useProjects } from '../projects/projects';
import { isOptional, projectKey, toggled } from './resources';

/**
 * Where a skill is enabled: everywhere, for chosen
 * profiles, for chosen projects, or nowhere (optional, picked per project or profile).
 */
export function ScopeEditor({ scope, onChange, disabled, name }: {
  scope: ResourceScope;
  onChange: (s: ResourceScope) => void;
  disabled?: boolean;
  /** Names the group for assistive technology, e.g. "Playwright CLI". */
  name: string;
}) {
  const { profiles = [] } = useProfiles();
  const { state } = useProjects();
  const projects = [...(state?.projects ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <fieldset className="scope-editor" disabled={disabled} aria-label={`Where ${name} is enabled`}>
      <legend>Enabled for</legend>
      <label className="check">
        <input type="checkbox" checked={scope.global} onChange={(e) => onChange({ ...scope, global: e.target.checked })} />
        <span>
          Enable everywhere
          <small>Every profile and project gets it.</small>
        </span>
      </label>
      <div className={`scope-lists${scope.global ? ' covered' : ''}`}>
        <div className="scope-list" role="group" aria-label="Profiles">
          <span className="scope-list-label">Profiles</span>
          {profiles.length === 0 && <small className="hint">No profiles yet.</small>}
          {profiles.map((p) => (
            <label key={p.id} className="check">
              <input type="checkbox" checked={scope.global || scope.profileIds.includes(p.id)} disabled={scope.global} onChange={(e) => onChange({ ...scope, profileIds: toggled(scope.profileIds, p.id, e.target.checked) })} />
              <span>{p.name}</span>
            </label>
          ))}
        </div>
        <div className="scope-list" role="group" aria-label="Projects">
          <span className="scope-list-label">Projects</span>
          {projects.length === 0 && <small className="hint">No projects yet.</small>}
          {projects.map((p) => (
            <label key={p.id} className="check">
              <input type="checkbox" checked={scope.global || scope.projectKeys.includes(projectKey(p))} disabled={scope.global} onChange={(e) => onChange({ ...scope, projectKeys: toggled(scope.projectKeys, projectKey(p), e.target.checked) })} />
              <span>
                {p.name}
                <small>{p.repoKey ?? 'local folder'}</small>
              </span>
            </label>
          ))}
        </div>
      </div>
      <small className="hint" role="status">
        {scope.global
          ? 'On everywhere. Profile and project choices are kept for when you turn this off.'
          : isOptional(scope)
            ? 'Optional: off everywhere until you select it here, in a profile, or in a project’s settings.'
            : 'On only for the selected profiles and projects.'}
      </small>
    </fieldset>
  );
}
