import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SkillContext, WorkspaceSkill } from '@accio/protocol';
import { emitAppEvent } from '../app/appEvents';
import { useClient } from '../app/connection';
import { Chevron, Plus, Refresh } from '../app/icons';
import { useAction } from '../app/useAction';
import { useProjects } from '../projects/projects';
import { shortRevision } from '../resources/resources';
import { byName, harnessName, isAddable, isHarnessSkill, isInherited, isOverridden, isProjectSkill, isSpaceSkill, LEVEL_NAMES, originLabel, skillReference, useWorkspaceSkills } from './workspaceSkills';

type SectionKey = 'project' | 'space' | 'profile' | 'global' | 'harness' | 'overridden';
/** The levels a library skill can be turned on at from the panel. */
type PanelLevel = 'project' | 'space';
const LEVEL_TARGET: Record<PanelLevel, string> = { project: 'this project', space: 'this space' };
/** Which sections are open, kept while the app runs so switching threads doesn't fold them again. */
const openSections = new Set<SectionKey>();

/**
 * The skills the open thread (or draft) gets on its next turn, one folded
 * section per skill level, narrowest first: the project's own (repository files
 * plus library skills it turned on), then its space's (the home's files plus library
 * skills the space turned on), then the profile's, then everywhere's; then the
 * skills its harness ships with, and last those a narrower level overrides (ADR 0020).
 * Changes apply from the next turn.
 */
export function SkillsPanel({ context, composer }: { context: SkillContext; composer: string }) {
  const { value, error, loading, reload } = useWorkspaceSkills(context);
  const { state: projects } = useProjects();
  const [announce, setAnnounce] = useState('');
  const [open, setOpen] = useState(() => new Set(openSections));
  const skills = useMemo(() => value?.skills ?? [], [value]);
  const own = useMemo(() => skills.filter(isProjectSkill).sort(byName), [skills]);
  const spaceWide = useMemo(() => skills.filter(isSpaceSkill).sort(byName), [skills]);
  const profile = useMemo(() => skills.filter((s) => isInherited(s) && s.enabledBy === 'profile').sort(byName), [skills]);
  const everywhere = useMemo(() => skills.filter((s) => isInherited(s) && s.enabledBy === 'global').sort(byName), [skills]);
  const addable = useMemo(() => skills.filter(isAddable).sort(byName), [skills]);
  const shipped = useMemo(() => skills.filter(isHarnessSkill).sort(byName), [skills]);
  const overridden = useMemo(() => skills.filter(isOverridden).sort(byName), [skills]);
  const harness = value?.harnessId ? harnessName(value.harnessId) : undefined;
  const project = value?.projectId ? projects?.projects.find((p) => p.id === value.projectId) : undefined;
  const row = { context, composer, onChanged: reload, onAnnounce: setAnnounce };
  const toggle = (key: SectionKey, next = !open.has(key)) => {
    if (next) openSections.add(key); else openSections.delete(key);
    setOpen(new Set(openSections));
  };
  const fold = (key: SectionKey) => ({ open: open.has(key), onToggle: () => toggle(key), threadId: context.threadId });

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

      {value.projectId
        ? <SkillsSection title="Project" skills={own} {...fold('project')} where="In this repository or turned on for this project."
          head={(title) => <AddSkill level="project" candidates={addable} context={context} title={title} onAnnounce={setAnnounce}
            onChanged={() => { toggle('project', true); reload(); }} />}
          empty={<p className="hint skills-message">No skills in this repository’s <code>.agents/skills</code> or <code>.claude/skills</code> and none added from the library.</p>}>
          {own.map((s) => <SkillItem key={s.id} skill={s} {...row} />)}
        </SkillsSection>
        : <section className="skills-section">
          <div className="skills-title-row"><h3 className="skills-title">Project</h3></div>
          <p className="hint skills-message">Project skills need a project. Start the thread in a project to add any.</p>
        </section>}
      {value.space && <SkillsSection title="Space" skills={spaceWide} {...fold('space')} where={`In the home of ${value.space.name} or turned on for this space.`}
        head={(title) => <AddSkill level="space" candidates={addable} context={context} title={title} onAnnounce={setAnnounce}
          onChanged={() => { toggle('space', true); reload(); }} />}
        empty={<p className="hint skills-message">{value.space.homeUnavailable ?? <>No skills in the home’s <code>.agents/skills</code> or <code>.claude/skills</code> and none added from the library for {value.space.name}.</>}</p>}>
        {value.space.homeUnavailable && spaceWide.length > 0 && <li><p className="hint skills-message">{value.space.homeUnavailable}</p></li>}
        {spaceWide.map((s) => <SkillItem key={s.id} skill={s} {...row} />)}
      </SkillsSection>}
      {profile.length > 0 && <SkillsSection title="Profile" skills={profile} {...fold('profile')} where="Turned on for this profile; change these in Settings → Skills.">
        {profile.map((s) => <SkillItem key={s.id} skill={s} {...row} />)}
      </SkillsSection>}
      {everywhere.length > 0 && <SkillsSection title="Everywhere" skills={everywhere} {...fold('global')} where="Turned on for every profile and project; change these in Settings → Skills.">
        {everywhere.map((s) => <SkillItem key={s.id} skill={s} {...row} />)}
      </SkillsSection>}
      {harness && shipped.length > 0 && <SkillsSection title={harness} skills={shipped} {...fold('harness')} where={`Ships with ${harness}.`}>
        {shipped.map((s) => <SkillItem key={s.id} skill={s} {...row} harness={harness} />)}
      </SkillsSection>}
      {overridden.length > 0 && <SkillsSection title="Overridden" skills={overridden} {...fold('overridden')} where="Turned on, but a narrower level has a skill of the same name, which this thread gets instead.">
        {overridden.map((s) => <SkillItem key={s.id} skill={s} {...row} />)}
      </SkillsSection>}
    </div>
  );
}

/** One skill level, folded behind how many skills it has and how many this thread loaded. `head` can wrap the title, for Add skill. */
function SkillsSection({ title, skills, open, onToggle, threadId, where, head, empty, children }: {
  title: string; skills: WorkspaceSkill[]; open: boolean; onToggle: () => void; threadId?: string; where: string;
  head?: (title: ReactNode) => ReactNode; empty?: ReactNode; children: ReactNode;
}) {
  const id = useId();
  const loaded = skills.filter((s) => s.loaded).length;
  const heading = (
    <h3 className="skills-title">
      <button type="button" className="skills-fold" aria-expanded={open} aria-controls={id} onClick={onToggle}
        title={`${skills.length} available${threadId ? ` · ${loaded} loaded` : ''}. ${where}`}>
        <span>{title}</span>
        <span className="skills-count">{skills.length}{loaded > 0 && ` · ${loaded} loaded`}</span>
        <Chevron />
      </button>
    </h3>
  );
  return (
    <section className="skills-section">
      {head ? head(heading) : heading}
      {open && <div id={id}>
        {skills.length === 0 && empty}
        <ul className="skill-list">{children}</ul>
      </div>}
    </section>
  );
}

type RowProps = { skill: WorkspaceSkill; context: SkillContext; composer: string; onChanged: () => void; onAnnounce: (text: string) => void; harness?: string };

function SkillItem({ skill, context, composer, onChanged, onAnnounce, harness }: RowProps) {
  const client = useClient();
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const disable = useAction();
  // A library skill turned on here, at the project or its space, can be turned off here at that level.
  const own: PanelLevel | undefined = skill.origin === 'library' && (skill.enabledBy === 'project' || skill.enabledBy === 'space') ? skill.enabledBy : undefined;
  const threadId = context.threadId;
  const winner = skill.overriddenBy && LEVEL_NAMES[skill.overriddenBy];

  return (
    <li className={`skill-item${open ? ' open' : ''}${winner ? ' overridden' : ''}`}>
      <div className="skill-line">
        <button type="button" className="skill-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
          <span className="skill-name">{skill.name}</span>
          {/* An overridden row's tag says where it stands, and a harness skill's section names its harness; the name keeps the room. */}
          {!winner && !harness && <span className="skill-origin">{originLabel(skill)}</span>}
        </button>
        {skill.conflict && <span className="tag bad" title={skill.conflict}>Conflict</span>}
        {winner && <span className="tag" title={`Turned on: ${originLabel(skill)}. ${winner} has a skill named ${skill.name}, which this thread gets instead.`}>Overridden by {winner}</span>}
        {threadId && skill.loaded && !winner && (
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
          <dd>{skill.origin === 'repository' ? 'This repository' : skill.origin === 'home' ? 'The space’s home' : skill.origin === 'harness' ? `Ships with ${harness ?? 'the harness'}` : skill.sourceName ?? 'Library'}{skill.revision && <> · <code title={skill.revision}>{shortRevision(skill.revision)}</code></>}</dd>
          {skill.path && <><dt>Path</dt>
          <dd><code className="skill-path" title={skill.path}>{skill.path}</code></dd></>}
        </dl>
        {skill.origin === 'harness' && !skill.path
          ? <p className="note">{harness ?? 'The harness'} doesn’t share this skill’s instructions. It is always on.</p>
          : <Instructions skill={skill} context={context} onAnnounce={onAnnounce} />}
        <div className="skill-actions">
          <button type="button" className="ghost" onClick={() => emitAppEvent('composer.insert', { target: composer, text: skillReference(skill) })}>Reference in message</button>
          {own && (
            <button type="button" className="ghost" disabled={disable.busy} onClick={async () => {
              const done = await disable.run(async () => (await client.call('threads.setSkillEnabled', { ...context, skillId: skill.id, enabled: false, level: own }), true));
              if (done) { onAnnounce(`${skill.name} disabled for ${LEVEL_TARGET[own]}. Applies from the next turn.`); onChanged(); }
            }}>{disable.busy ? 'Disabling…' : `Disable for ${LEVEL_TARGET[own]}`}</button>
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

/** Search every library skill not yet on here and turn one on for this project, or for its space. */
function AddSkill({ level, candidates, context, onChanged, onAnnounce, title }: { level: PanelLevel; candidates: WorkspaceSkill[]; context: SkillContext; onChanged: () => void; onAnnounce: (text: string) => void; title: ReactNode }) {
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
    const done = await run(async () => (await client.call('threads.setSkillEnabled', { ...context, skillId: skill.id, enabled: true, level }), true));
    if (!done) return;
    onAnnounce(`${skill.name} added to ${LEVEL_TARGET[level]}. Applies from the next turn.`);
    onChanged();
    close();
  };

  const head = (
    <div className="skills-title-row">
      {title}
      <button ref={opener} type="button" className="side-icon" title={`Add skill to ${LEVEL_TARGET[level]}`} aria-label={`Add skill to ${LEVEL_TARGET[level]}`} aria-pressed={open}
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
