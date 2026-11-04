import { useMemo, useState, type FormEvent } from 'react';
import type { ResourceScope, ResourcesState, SkillEntry, SkillSource } from '@accio/protocol';
import { useClient } from '../app/connection';
import { BookOpen } from '../app/icons';
import { SettingLink, SettingRow, SettingsFooter, SettingsSection } from '../app/Settings';
import { useAction } from '../app/useAction';
import { useProfiles } from '../profiles/profiles';
import { useProjects } from '../projects/projects';
import { isOptional, LoadError, scopeSummary, shortRevision, slugId, useResources } from '../resources/resources';
import { ScopeEditor } from '../resources/ScopeEditor';
import { Field, focusFirstInvalid } from '../resources/Field';
import { MidPath } from '../projects/MidPath';

const activeRevision = (state: ResourcesState, sourceId: string) => state.skills.find((s) => s.sourceId === sourceId)?.revision;

/** Git repositories of skills. The hub keeps each fetched revision; nothing updates until you apply it. */
export function SkillsSettings({ sourceId, onOpen, onBack }: { sourceId?: string; onOpen: (id: string) => void; onBack: () => void }) {
  const { state, loadError, retry } = useResources();
  if (!state) return loadError ? <LoadError error={loadError} retry={retry} /> : <p className="note" role="status">Loading skills…</p>;
  if (sourceId === 'new') return <AddSource taken={state.sources.map((s) => s.id)} onAdded={(s) => onOpen(s.id)} onCancel={onBack} />;
  const source = state.sources.find((s) => s.id === sourceId);
  if (sourceId && !source) return <><p className="note">This skill source was deleted.</p><button className="link" onClick={onBack}>All skill sources</button></>;
  if (source) return <SourceDetail key={source.id} source={source} state={state} onDeleted={onBack} />;
  return (
    <>
      <p className="note">
        Skills come from Git repositories. A new skill is optional until you enable it for everything, a profile, or a project. Enabled skills are synced: threads read them from the hub’s copy at the revision you applied.
      </p>
      <SettingsSection add={{ label: 'Add skill source', onClick: () => onOpen('new') }}>
        {[...state.sources].sort((a, b) => a.name.localeCompare(b.name)).map((s) => {
          const skills = state.skills.filter((k) => k.sourceId === s.id);
          const enabled = skills.filter((k) => !isOptional(k.scope)).length;
          const rev = activeRevision(state, s.id);
          return (
            <SettingLink key={s.id} icon={<BookOpen />} title={s.name} description={<span className="source-line"><span>{skills.length} skill{skills.length === 1 ? '' : 's'} · {enabled} enabled, {skills.length - enabled} optional ·</span><MidPath text={s.url} /></span>} onClick={() => onOpen(s.id)}>
              {rev && <code className="revision" title={rev}>{shortRevision(rev)}</code>}
            </SettingLink>
          );
        })}
      </SettingsSection>
    </>
  );
}

function AddSource({ taken, onAdded, onCancel }: { taken: string[]; onAdded: (s: SkillSource) => void; onCancel: () => void }) {
  const client = useClient();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [ref, setRef] = useState('');
  const [touched, setTouched] = useState(false);
  const { busy, error, run } = useAction();
  const problems = {
    name: !name.trim() ? 'Give the source a name.' : undefined,
    url: !url.trim() ? 'Enter a Git URL or path.' : url.trim().startsWith('-') ? 'A Git URL can’t start with “-”.' : undefined,
    ref: ref.trim().startsWith('-') ? 'A revision can’t start with “-”.' : undefined,
  };
  const invalid = Object.values(problems).some(Boolean);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (invalid) return focusFirstInvalid(e.currentTarget);
    const saved = await run(() => client.call('skills.addSource', { id: slugId(name, taken), name: name.trim(), url: url.trim(), ref: ref.trim() || 'HEAD' }));
    if (saved) onAdded(saved);
  };
  return (
    <form className="settings-profile-form" onSubmit={submit} noValidate>
      <SettingsSection>
        <div className="setting-form">
          <Field label="Name" error={touched && problems.name}>
            {(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="spellbook" maxLength={120} autoFocus disabled={busy} />}
          </Field>
          <Field label="Git URL" error={(touched || !!url) && problems.url}>
            {(p) => <input {...p} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/skills.git" spellCheck={false} disabled={busy} />}
          </Field>
          <Field label="Branch, tag or commit (optional)" error={problems.ref}>
            {(p) => <input {...p} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="HEAD" spellCheck={false} disabled={busy} />}
          </Field>
          <small className="hint">The hub clones it with its own Git credentials. Its skills start optional.</small>
          {busy && <p className="note" role="status">Cloning and reading SKILL.md files…</p>}
        </div>
      </SettingsSection>
      {error && <p className="error" role="alert">{error}</p>}
      <SettingsFooter busy={busy} onCancel={onCancel} saveLabel={busy ? 'Adding…' : 'Add source'} saveDisabled={busy} dirty={!!(name || url || ref) && !busy} />
    </form>
  );
}

type Diff = { added: SkillEntry[]; removed: SkillEntry[]; changed: SkillEntry[]; same: number };
function diff(current: SkillEntry[], next: SkillEntry[]): Diff {
  const byId = new Map(current.map((s) => [s.id, s]));
  const nextIds = new Set(next.map((s) => s.id));
  return {
    added: next.filter((s) => !byId.has(s.id)),
    removed: current.filter((s) => !nextIds.has(s.id)),
    changed: next.filter((s) => byId.has(s.id) && (byId.get(s.id)!.description !== s.description || byId.get(s.id)!.name !== s.name)),
    same: next.filter((s) => byId.has(s.id) && byId.get(s.id)!.description === s.description && byId.get(s.id)!.name === s.name).length,
  };
}

function SourceDetail({ source, state, onDeleted }: { source: SkillSource; state: ResourcesState; onDeleted: () => void }) {
  const client = useClient();
  const skills = useMemo(() => state.skills.filter((s) => s.sourceId === source.id).sort((a, b) => a.name.localeCompare(b.name)), [state.skills, source.id]);
  const active = activeRevision(state, source.id);
  const versions = state.skillVersions.filter((v) => v.sourceId === source.id).reverse();
  const [preview, setPreview] = useState<SkillEntry[]>();
  const check = useAction();
  const apply = useAction();
  const del = useAction();
  const previewRev = preview?.[0]?.revision;
  const changes = preview && previewRev !== active ? diff(skills, preview) : undefined;

  const applyRevision = async (revision: string) => {
    const done = await apply.run(() => client.call('skills.applyUpdate', { id: source.id, revision }));
    if (done) setPreview(undefined);
  };

  return (
    <>
      <SettingsSection>
        <SettingRow title="Repository"><MidPath text={source.url} /></SettingRow>
        <SettingRow title="Follows"><code>{source.ref}</code></SettingRow>
        <SettingRow title="Active revision" description="Threads get skills from this revision until you apply another.">
          {active ? <code title={active}>{shortRevision(active)}</code> : <span className="dim">None</span>}
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="Updates">
        <div className="setting-form">
          <div className="update-row">
            <span className="grow note">Fetch {source.ref} again to see what changed. Nothing changes until you apply it.</span>
            <button type="button" className="ghost" disabled={check.busy || apply.busy} onClick={async () => { const r = await check.run(() => client.call('skills.previewUpdate', { id: source.id })); if (r) setPreview(r); }}>
              {check.busy ? 'Fetching…' : 'Check for updates'}
            </button>
          </div>
          {preview && !changes && <p className="note" role="status">Up to date at <code>{previewRev && shortRevision(previewRev)}</code>.</p>}
          {changes && previewRev && (
            <div className="update-preview" role="region" aria-label={`Revision ${shortRevision(previewRev)}`}>
              <p className="note">
                <code>{active ? shortRevision(active) : 'none'}</code> → <code title={previewRev}>{shortRevision(previewRev)}</code>
                {' · '}{changes.added.length} new, {changes.changed.length} changed, {changes.removed.length} removed{changes.same > 0 && `, ${changes.same} with the same name and description`}
              </p>
              {(changes.added.length + changes.changed.length + changes.removed.length) > 0 && (
                <ul className="update-changes">
                  {changes.added.map((s) => <li key={s.id}><span className="tag ok">New</span><b>{s.name}</b> <small>{s.description}</small></li>)}
                  {changes.changed.map((s) => <li key={s.id}><span className="tag">Changed</span><b>{s.name}</b> <small>{s.description}</small></li>)}
                  {changes.removed.map((s) => <li key={s.id}><span className="tag bad">Removed</span><b>{s.name}</b></li>)}
                </ul>
              )}
              <small className="hint">Files inside a skill may have changed too. Kept skills keep where they’re enabled; new ones start optional.</small>
              <div className="update-row">
                <span className="spacer" />
                <button type="button" className="ghost" disabled={apply.busy} onClick={() => setPreview(undefined)}>Not now</button>
                <button type="button" className="ghost primary" disabled={apply.busy} onClick={() => applyRevision(previewRev)}>{apply.busy ? 'Applying…' : `Apply ${shortRevision(previewRev)}`}</button>
              </div>
            </div>
          )}
          {check.error && <p className="error" role="alert">{check.error}</p>}
        </div>
        {versions.length > 1 && (
          <div className="setting-form">
            <span className="scope-list-label">Fetched revisions</span>
            <div className="list">
              {versions.map((v) => (
                <div key={v.revision} className="list-row static">
                  <code className="grow" title={v.revision}>{shortRevision(v.revision)}</code>
                  {v.active
                    ? <span className="pill ok"><span className="dot" />Active</span>
                    : <button type="button" className="ghost" disabled={apply.busy} onClick={() => applyRevision(v.revision)}>Switch to this revision</button>}
                </div>
              ))}
            </div>
            <small className="hint">Roll back or forward to any revision the hub already fetched, newest first.</small>
          </div>
        )}
        {apply.error && <div className="setting-form"><p className="error" role="alert">{apply.error}</p></div>}
      </SettingsSection>

      <section className="settings-section">
        <h2>Skills</h2>
        <div className="settings-card">
          {skills.length === 0 && <SettingRow title="No skills in this revision" />}
          {skills.map((s) => <SkillRow key={s.id} skill={s} />)}
        </div>
      </section>

      {del.error && <p className="error" role="alert">{del.error}</p>}
      <SettingsFooter remove={{ name: source.name, run: async () => { if (await del.run(async () => (await client.call('skills.deleteSource', { id: source.id }), true))) onDeleted(); }, consequence: `Also removes its ${skills.length} skill${skills.length === 1 ? '' : 's'}.` }} busy={del.busy} onCancel={onDeleted} />

    </>
  );
}

function SkillRow({ skill }: { skill: SkillEntry }) {
  const client = useClient();
  const { profiles = [] } = useProfiles();
  const { state: projects, checkoutsOf } = useProjects();
  const [open, setOpen] = useState<'scope' | 'copy'>();
  const [draft, setDraft] = useState<ResourceScope>();
  const [checkoutId, setCheckoutId] = useState('');
  const [copied, setCopied] = useState<string>();
  const save = useAction();
  const copy = useAction();
  const scope = draft ?? skill.scope;
  const changed = draft !== undefined && JSON.stringify(draft) !== JSON.stringify(skill.scope);
  const checkouts = (projects?.projects ?? []).flatMap((p) => checkoutsOf(p.id).map((c) => ({ ...c, project: p.name })));

  return (
    <div className="skill-row">
      <div className="setting">
        <span className="setting-text">
          <b>{skill.name}</b>
          {skill.description && <small>{skill.description}</small>}
          <small className={isOptional(skill.scope) ? 'dim' : 'on-text'}>{isOptional(skill.scope) ? 'Optional' : `On for ${scopeSummary(skill.scope, profiles, projects?.projects)}`}</small>
        </span>
        <span className="setting-value">
          <button type="button" className="ghost" title="Keep it managed by Accio: it follows this source's applied revision" aria-expanded={open === 'scope'} onClick={() => setOpen(open === 'scope' ? undefined : 'scope')}>Enable for…</button>
          <button type="button" className="ghost" title="Write an independent copy to the project's .agents/skills/ to commit and edit; it never updates" aria-expanded={open === 'copy'} onClick={() => { setOpen(open === 'copy' ? undefined : 'copy'); setCopied(undefined); }}>Copy into project</button>
        </span>
      </div>
      {open === 'scope' && (
        <div className="setting-form skill-panel">
          <ScopeEditor name={skill.name} scope={scope} onChange={setDraft} disabled={save.busy} />
          {save.error && <p className="error" role="alert">{save.error}</p>}
          <div className="update-row">
            <span className="spacer" />
            <button type="button" className="ghost" onClick={() => { setDraft(undefined); setOpen(undefined); }}>Cancel</button>
            <button type="button" className="ghost primary" disabled={save.busy || !changed}
              onClick={async () => { if (await save.run(() => client.call('skills.setScope', { id: skill.id, scope }))) { setDraft(undefined); setOpen(undefined); } }}>
              {save.busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
      {open === 'copy' && (
        <div className="setting-form skill-panel">
          {checkouts.length === 0 ? <p className="note">Add a project on this machine first.</p> : (
            <>
              <label className="field">
                <span>Checkout on this machine</span>
                <select value={checkoutId} onChange={(e) => { setCheckoutId(e.target.value); setCopied(undefined); }} disabled={copy.busy}>
                  <option value="">Choose a checkout…</option>
                  {checkouts.map((c) => <option key={c.id} value={c.id}>{c.project} · {c.path}</option>)}
                </select>
              </label>
              <small className="hint">Copies this revision’s files to <code>.agents/skills/{skill.name.replace(/[^a-zA-Z0-9_-]/g, '-')}</code>. An existing skill folder there is never overwritten.</small>
              {copied && <p className="note" role="status">Copied to <code>{copied}</code>. Commit it to share it with the project.</p>}
              {copy.error && <p className="error" role="alert">{copy.error}</p>}
              <div className="update-row">
                <span className="spacer" />
                <button type="button" className="ghost primary" disabled={copy.busy || !checkoutId}
                  onClick={async () => { setCopied(undefined); const r = await copy.run(() => client.call('skills.copy', { id: skill.id, checkoutId })); if (r) setCopied(r.path); }}>
                  {copy.busy ? 'Copying…' : 'Copy'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
