import { useMemo, useState } from 'react';
import type { ProfileView, ProjectView, ResourceScope, SkillEntry } from '@accio/protocol';
import { useClient } from '../app/connection';
import { useAction } from '../app/useAction';
import { useProfiles } from '../profiles/profiles';
import { enabledBecause, projectKey, toggled, useResources } from './resources';

type Context = { kind: 'project'; project: ProjectView } | { kind: 'profile'; profile: ProfileView };
type Item = { id: string; key: string; kind: 'skill'; name: string; detail: string; scope: ResourceScope; save: (scope: ResourceScope) => Promise<unknown> };

/** Skill choices held by the caller until it saves: the wanted state by skill id. */
export type Staged = { values: Record<string, boolean>; set: (skillId: string, on: boolean) => void };

/**
 * Turn the hub's skills on or off for one project or
 * profile. Only this project's (or profile's) own selection changes; the rest of
 * each resource's scope is kept as it is. Changes save immediately, or, given `staged`, wait in the caller's draft.
 */
export function ResourcePicker({ context, staged }: { context: Context; staged?: Staged }) {
  const client = useClient();
  const { state, loadError, retry } = useResources();
  const { profiles = [] } = useProfiles();
  const [query, setQuery] = useState('');
  const profileId = context.kind === 'profile' ? context.profile.id : context.project.profileId;
  const key = context.kind === 'project' ? projectKey(context.project) : undefined;
  const profileName = profiles.find((p) => p.id === profileId)?.name ?? 'its profile';

  const groups = useMemo(() => {
    if (!state) return [];
    const sourceName = (id: string) => state.sources.find((s) => s.id === id)?.name ?? id;
    const skill = (s: SkillEntry): Item => ({ id: s.id, key: `skill:${s.id}`, kind: 'skill', name: s.name, detail: s.description || sourceName(s.sourceId), scope: s.scope, save: (scope) => client.call('skills.setScope', { id: s.id, scope }) });
    const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);
    return [
      { title: 'Skills', empty: 'No skills yet. Add a skill source in Settings / Skills.', items: [...state.skills].sort(byName).map(skill) },
    ];
  }, [state, client]);

  const enabledSkillNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of state?.skills ?? []) if (enabledBecause(s.scope, profileId, key)) counts.set(s.name, (counts.get(s.name) ?? 0) + 1);
    return counts;
  }, [state, profileId, key]);

  if (loadError && !state) return <p className="error" role="alert">Could not load skills: {loadError} <button type="button" className="link" onClick={retry}>Retry</button></p>;
  if (!state) return <p className="note" role="status">Loading skills…</p>;

  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const q = query.trim().toLowerCase();
  return (
    <div className="resource-picker">
      {total > 8 && (
        <input className="resource-search" type="search" aria-label="Filter skills" placeholder="Filter…" value={query} onChange={(e) => setQuery(e.target.value)} />
      )}
      {groups.map((g) => {
        const items = q ? g.items.filter((i) => `${i.name} ${i.detail}`.toLowerCase().includes(q)) : g.items;
        return (
          <div key={g.title} className="resource-group" role="group" aria-label={g.title}>
            <span className="scope-list-label">{g.title}</span>
            {g.items.length === 0 && <small className="hint">{g.empty}</small>}
            {g.items.length > 0 && items.length === 0 && <small className="hint">No matches.</small>}
            {items.map((i) => (
              <PickerRow key={i.key} item={i} context={context} staged={staged} profileId={profileId} projectKey={key} profileName={profileName}
                clash={i.kind === 'skill' && (enabledSkillNames.get(i.name) ?? 0) > 1 && !!enabledBecause(i.scope, profileId, key)} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function PickerRow({ item, context, staged, profileId, projectKey: key, profileName, clash }: { item: Item; context: Context; staged?: Staged; profileId: string; projectKey?: string; profileName: string; clash: boolean }) {
  const { busy, error, run } = useAction();
  // Shown while saving, so the box doesn’t snap back before the hub confirms.
  const [pending, setPending] = useState<boolean>();
  const own = staged?.values[item.id] ?? (context.kind === 'project' ? item.scope.projectKeys.includes(key!) : item.scope.profileIds.includes(profileId));
  const inherited = context.kind === 'project' ? enabledBecause({ ...item.scope, projectKeys: [] }, profileId) : item.scope.global ? 'global' : undefined;
  const on = own || !!inherited;
  const status = inherited === 'global'
    ? 'On everywhere'
    : inherited === 'profile'
      ? `On for profile ${profileName}`
      : own
        ? context.kind === 'project' ? 'On for this project' : 'On for this profile'
        : 'Optional';
  const change = (checked: boolean) => {
    if (staged) { staged.set(item.id, checked); return Promise.resolve(); }
    setPending(checked);
    return run(() => item.save(context.kind === 'project'
      ? { ...item.scope, projectKeys: toggled(item.scope.projectKeys, key!, checked) }
      : { ...item.scope, profileIds: toggled(item.scope.profileIds, profileId, checked) })).finally(() => setPending(undefined));
  };
  const where = context.kind === 'project' ? 'this project' : 'this profile';
  return (
    <div className={`picker-row${on ? ' on' : ''}`}>
      <label className="check">
        <input
          type="checkbox"
          checked={pending ?? on}
          disabled={busy || !!inherited}
          onChange={(e) => void change(e.target.checked)}
          aria-describedby={`${item.key}-status`}
        />
        <span>
          {item.name}
          {item.detail && <small className="picker-detail">{item.detail}</small>}
        </span>
      </label>
      <small id={`${item.key}-status`} className={`picker-status${inherited ? ' inherited' : own ? ' own' : ''}`}>
        {busy ? 'Saving…' : status}
        {inherited && own && ` · also selected for ${where}`}
      </small>
      {clash && <small className="warn picker-note">Another enabled skill is also named {item.name}. Turns stop until only one is on.</small>}
      {inherited && (
        <small className="hint picker-note">
          {inherited === 'global' ? 'Turned on for everything in Settings.' : `Inherited from ${profileName}.`}
          {own ? <> Also selected for {where}. <button type="button" className="link" disabled={busy} onClick={() => void change(false)}>Clear {where}’s selection</button></> : ' Change it there.'}
        </small>
      )}
      {error && <small className="error picker-note" role="alert">{error}</small>}
    </div>
  );
}
