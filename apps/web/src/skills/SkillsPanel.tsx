import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SkillContext, WorkspaceSkill } from '@accio/protocol';
import { emitAppEvent } from '../app/appEvents';
import { useClient } from '../app/connection';
import { Chevron, Plus, Refresh } from '../app/icons';
import { useAction } from '../app/useAction';
import { useProjects } from '../projects/projects';
import { shortRevision } from '../resources/resources';
import { byName, isAddable, isInherited, isProjectSkill, originLabel, skillReference, useWorkspaceSkills } from './workspaceSkills';
import './skills-panel.css';

/**
 * The skills the open thread (or draft) gets on its next turn: the project's
 * own (repository files plus library skills it turned on) first, then what the
 * profile or everything passes down. Changes apply from the next turn.
 */
export function SkillsPanel({ context, composer }: { context: SkillContext; composer: string }) {
  const { value, error, loading, reload } = useWorkspaceSkills(context);
  const { state: projects } = useProjects();
  const [inheritedOpen, setInheritedOpen] = useState(false);
  const [announce, setAnnounce] = useState('');
  const inheritedId = useId();
  const skills = value?.skills ?? [];
  const own = useMemo(() => skills.filter(isProjectSkill).sort(byName), [skills]);
  const inherited = useMemo(() => skills.filter(isInherited).sort(byName), [skills]);
  const addable = useMemo(() => skills.filter(isAddable).sort(byName), [skills]);
  const project = value?.projectId ? projects?.projects.find((p) => p.id === value.projectId) : undefined;
  const loadedInherited = inherited.filter((s) => s.loaded).length;
  const row = { context, composer, onChanged: reload, onAnnounce: setAnnounce };

  if (!value) {
    return <div className="skills-panel">
      {error
        ? <div className="skills-message"><p className="error" role="alert">Could not load skills: {error}</p><button type="button" className="ghost" onClick={reload}>Retry</button></div>
        : <p className="note skills-message" role="status">Loading skills…</p>}
    </div>;
  }

  return (
    <div className="skills-panel" aria-busy={loading}>
      <div className="skills-head">
        <p className="note grow">{project ? <>For <b>{project.name}</b></> : value.projectId ? 'For this project' : 'No project'}</p>
        <button type="button" className="side-icon" title="Refresh skills. Changes apply from the next turn." aria-label="Refresh skills" disabled={loading} onClick={reload}><Refresh /></button>
      </div>
      {error && <p className="error skills-message" role="alert">Could not refresh skills: {error} <button type="button" className="link" onClick={reload}>Retry</button></p>}
      {value.unavailable && <p className="note skills-message" role="status">{value.unavailable}</p>}
      <p className="skills-live" role="status" aria-live="polite">{announce}</p>

      <section className="skills-section" aria-labelledby={`${inheritedId}-project`}>
        {value.projectId
          ? <AddSkill candidates={addable} context={context} onChanged={reload} onAnnounce={setAnnounce}
            title={<h3 id={`${inheritedId}-project`} className="skills-title">Project <span className="skills-count">{own.length}</span></h3>} />
          : <>
            <div className="skills-title-row"><h3 id={`${inheritedId}-project`} className="skills-title">Project</h3></div>
            <p className="hint skills-message">Project skills need a project. Start the thread in a project to add any.</p>
          </>}
        {value.projectId && own.length === 0 && <p className="hint skills-message">No skills in this repository’s <code>.agents/skills</code> or <code>.claude/skills</code> and none added from the library.</p>}
        <ul className="skill-list">{own.map((s) => <SkillItem key={s.id} skill={s} {...row} />)}</ul>
      </section>

      <section className="skills-section">
        <h3 className="skills-title">
          <button type="button" className="skills-fold" aria-expanded={inheritedOpen} aria-controls={inheritedId} onClick={() => setInheritedOpen(!inheritedOpen)}
            title={`${inherited.length} available${context.threadId ? ` · ${loadedInherited} loaded` : ''}. From the profile or everywhere; change these in Settings → Skills.`}>
            <span>Inherited</span>
            <span className="skills-count">{inherited.length}{loadedInherited > 0 && ` · ${loadedInherited} loaded`}</span>
            <Chevron />
          </button>
        </h3>
        {inheritedOpen && <div id={inheritedId}>
          {inherited.length === 0 && <p className="hint skills-message">Nothing is turned on for this profile or everywhere.</p>}
          <ul className="skill-list">{inherited.map((s) => <SkillItem key={s.id} skill={s} {...row} />)}</ul>
        </div>}
      </section>
    </div>
  );
}

type RowProps = { skill: WorkspaceSkill; context: SkillContext; composer: string; onChanged: () => void; onAnnounce: (text: string) => void };

function SkillItem({ skill, context, composer, onChanged, onAnnounce }: RowProps) {
  const client = useClient();
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const disable = useAction();
  const own = skill.origin === 'library' && skill.enabledBy === 'project';
  const threadId = context.threadId;

  return (
    <li className={`skill-item${open ? ' open' : ''}`}>
      <div className="skill-line">
        <button type="button" className="skill-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
          <span className="skill-name">{skill.name}</span>
          <span className="skill-origin">{originLabel(skill)}</span>
        </button>
        {skill.conflict && <span className="tag bad" title={skill.conflict}>Conflict</span>}
        {threadId && skill.loaded && (
          <button type="button" className="tag ok skill-loaded" title="Seen reading or invoking it this thread (no mark doesn’t mean unused). Show it in the transcript."
            aria-label={`${skill.name}: loaded this thread. Show in transcript`}
            onClick={() => emitAppEvent('transcript.reveal', { threadId, itemId: skill.loaded!.itemId })}>
            Loaded
          </button>
        )}
      </div>
      {!open && skill.description && <p className="skill-desc">{skill.description}</p>}
      {open && <div className="skill-body" id={bodyId}>
        {skill.description && <p className="skill-desc full">{skill.description}</p>}
        {skill.conflict && <p className="warn" role="note">{skill.conflict}</p>}
        <dl className="skill-facts">
          <dt>Source</dt>
          <dd>{skill.origin === 'repository' ? 'This repository' : skill.sourceName ?? 'Library'}{skill.revision && <> · <code title={skill.revision}>{shortRevision(skill.revision)}</code></>}</dd>
          <dt>Path</dt>
          <dd><code className="skill-path" title={skill.path}>{skill.path}</code></dd>
        </dl>
        <Instructions skill={skill} context={context} onAnnounce={onAnnounce} />
        <div className="skill-actions">
          <button type="button" className="ghost" onClick={() => emitAppEvent('composer.insert', { target: composer, text: skillReference(skill) })}>Reference in message</button>
          {own && (
            <button type="button" className="ghost" disabled={disable.busy} onClick={async () => {
              const done = await disable.run(async () => (await client.call('threads.setSkillEnabled', { ...context, skillId: skill.id, enabled: false }), true));
              if (done) { onAnnounce(`${skill.name} disabled for this project. Applies from the next turn.`); onChanged(); }
            }}>{disable.busy ? 'Disabling…' : 'Disable for this project'}</button>
          )}
        </div>
        {disable.error && <p className="error" role="alert">{disable.error}</p>}
      </div>}
    </li>
  );
}

/** A skill's SKILL.md, read when its row opens; repository copies can be edited in place. */
function Instructions({ skill, context, onAnnounce }: { skill: WorkspaceSkill; context: SkillContext; onAnnounce: (text: string) => void }) {
  const client = useClient();
  const [loaded, setLoaded] = useState<{ content: string; path: string; editable: boolean }>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState<string>();
  const [saved, setSaved] = useState(false);
  const save = useAction();
  const label = useId();

  useEffect(() => {
    let active = true;
    setError(undefined);
    void client.call('threads.skillContent', { ...context, skillId: skill.id }).then((result) => {
      if (active) setLoaded(result);
    }, (cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { active = false; };
    // A new revision is new content; the context object itself is rebuilt each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, JSON.stringify(context), skill.id, skill.revision, attempt]);

  const editable = skill.origin === 'repository' && !!loaded?.editable;
  const changed = draft !== undefined && draft !== loaded?.content;

  return (
    <div className="skill-instructions">
      <span className="skill-label" id={label}>Instructions</span>
      {error && <p className="error" role="alert">Could not read instructions: {error} <button type="button" className="link" onClick={() => setAttempt((n) => n + 1)}>Retry</button></p>}
      {!loaded && !error && <p className="note" role="status">Reading instructions…</p>}
      {loaded && draft === undefined && <pre className="skill-content" aria-labelledby={label} tabIndex={0}>{loaded.content || 'Empty.'}</pre>}
      {loaded && draft !== undefined && (
        <textarea className="skill-editor" aria-labelledby={label} value={draft} spellCheck={false} disabled={save.busy}
          onChange={(e) => { setDraft(e.target.value); setSaved(false); }}
          onKeyDown={(e) => { if (e.key === 'Escape' && !changed) setDraft(undefined); }} autoFocus />
      )}
      {save.error && <p className="error" role="alert">{save.error}</p>}
      {saved && draft === undefined && <p className="note" role="status">Saved to the repository. Applies from the next turn.</p>}
      {editable && (
        <div className="skill-actions">
          {draft === undefined
            ? <button type="button" className="ghost" onClick={() => { setDraft(loaded!.content); setSaved(false); }}>Edit instructions</button>
            : <>
              <button type="button" className="ghost" disabled={save.busy} onClick={() => { setDraft(undefined); save.clear(); }}>Cancel</button>
              <button type="button" className="ghost primary" disabled={save.busy || !changed} onClick={async () => {
                const content = draft;
                const done = await save.run(async () => (await client.call('threads.saveSkillContent', { ...context, skillId: skill.id, content }), true));
                if (!done) return;
                setLoaded({ ...loaded!, content });
                setDraft(undefined);
                setSaved(true);
                onAnnounce(`Saved ${skill.name}.`);
              }}>{save.busy ? 'Saving…' : 'Save'}</button>
            </>}
        </div>
      )}
    </div>
  );
}

/** Search every library skill not yet on here and turn one on for this project. */
function AddSkill({ candidates, context, onChanged, onAnnounce, title }: { candidates: WorkspaceSkill[]; context: SkillContext; onChanged: () => void; onAnnounce: (text: string) => void; title: ReactNode }) {
  const client = useClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const { busy, error, run, clear } = useAction();
  const opener = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const q = query.trim().toLowerCase();
  const matches = q ? candidates.filter((s) => `${s.name} ${s.description} ${s.sourceName ?? ''}`.toLowerCase().includes(q)) : candidates;
  const current = Math.min(active, matches.length - 1);

  const close = () => {
    setOpen(false);
    setQuery('');
    clear();
    requestAnimationFrame(() => opener.current?.focus());
  };
  const enable = async (skill: WorkspaceSkill) => {
    const done = await run(async () => (await client.call('threads.setSkillEnabled', { ...context, skillId: skill.id, enabled: true }), true));
    if (!done) return;
    onAnnounce(`${skill.name} added to this project. Applies from the next turn.`);
    onChanged();
    close();
  };

  const head = (
    <div className="skills-title-row">
      {title}
      <button ref={opener} type="button" className="side-icon" title="Add skill" aria-label="Add skill" aria-pressed={open}
        onMouseDown={(e) => { if (open) e.preventDefault(); }} onClick={() => (open ? close() : setOpen(true))}><Plus /></button>
    </div>
  );
  if (!open) return head;
  return (<>
    {head}
    <div className="skills-picker">
      <input
        type="text" role="combobox" autoFocus spellCheck={false} placeholder="Search library skills…"
        aria-label="Search library skills" aria-expanded="true" aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={matches[current] ? `${listId}-${current}` : undefined}
        value={query} disabled={busy}
        onChange={(e) => { setQuery(e.target.value); setActive(0); }}
        onBlur={(e) => { if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null) && !busy) close(); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(current + 1, matches.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(current - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); const pick = matches[current]; if (pick) void enable(pick); }
          else if (e.key === 'Escape') { e.preventDefault(); close(); }
        }}
      />
      <ul className="skills-options" id={listId} role="listbox" aria-label="Library skills">
        {matches.map((s, index) => (
          <li key={s.id} id={`${listId}-${index}`} role="option" aria-selected={index === current} className={index === current ? 'active' : undefined}
            onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => void enable(s)}>
            <span className="skill-name">{s.name}</span>
            {s.sourceName && <span className="skill-origin">{s.sourceName}</span>}
            {s.description && <small className="skill-desc">{s.description}</small>}
          </li>
        ))}
      </ul>
      {matches.length === 0 && <p className="hint skills-message" role="status">
        {candidates.length === 0 ? 'No library skills left to add. Add skill sources in Settings → Skills.' : 'No matching skills.'}
      </p>}
      {busy && <p className="note skills-message" role="status">Adding…</p>}
      {error && <p className="error skills-message" role="alert">{error}</p>}
    </div>
  </>);
}
