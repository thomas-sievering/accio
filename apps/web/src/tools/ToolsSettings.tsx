import { useState, type FormEvent, type ReactNode } from 'react';
import { ToolDefinition, type MachineView, type ResourceScope, type ToolEntry, type ToolStatus } from '@accio/protocol';
import { useClient } from '../app/connection';
import { Wrench } from '../app/icons';
import { NEW, SettingLink, SettingsFooter, SettingsSection, type SettingsNav } from '../app/Settings';
import { useAction } from '../app/useAction';
import { useLive } from '../app/useLive';
import { hasSignedInAccount, useProfiles } from '../profiles/profiles';
import { scopeSummary, slugId, useDraft, useResources } from '../resources/resources';
import { ScopeEditor } from '../resources/ScopeEditor';
import { useProjects } from '../projects/projects';
import { useSpaces } from '../spaces/spaces';
import { Field, focusFirstInvalid } from '../resources/Field';
import { readiness, ToolStatusCard } from './ToolStatusCard';
import { MenuSelect } from '../ui/MenuSelect';

/** `npm view @playwright/cli version` on 2026-11-03. Editable before saving. */
const PLAYWRIGHT_CLI = { name: 'Playwright CLI', package: '@playwright/cli', version: '0.1.23', executable: 'playwright-cli', checkArgs: ['--version'] };

type Draft = Omit<ToolDefinition, 'id'> & { id: string; scope: ResourceScope };
const everywhere = (): ResourceScope => ({ global: true, profileIds: [], spaceIds: [], projectKeys: [] });
const blank = (): Draft => ({ id: '', name: '', package: '', version: '', executable: '', checkArgs: ['--version'], description: '', repairProfileId: undefined, scope: everywhere() });

/** The CLIs and machines, for Settings / CLIs. */
export function useToolsData() {
  const client = useClient();
  const { state, loadError, retry } = useResources();
  const machines = useLive(() => client.call('machines.list', {}), 'machines.changed');
  return { items: state?.tools, error: loadError, retry, state, machines };
}
type Props = { nav: SettingsNav; data: ReturnType<typeof useToolsData> };

/** GLOSSARY: CLI. Command-line programs the hub has each machine install with pnpm and lists to threads at their levels. */
export function ToolsList({ nav, data }: Props) {
  const { profiles = [] } = useProfiles();
  const { state: projects } = useProjects();
  const { spaces = [] } = useSpaces();
  const state = data.state!;
  const here = data.machines?.find((m) => m.thisMachine);
  return (
    <>
      <p className="note">Command-line programs from npm. Accio installs each CLI’s exact version with pnpm once on every machine, checks it, and lists it to the threads at its levels, with its description, on their PATH. A program you installed yourself isn’t available to threads until you add it here. A failed check starts a repair thread; threads keep running without that CLI.</p>
      <SettingsSection add={{ label: 'Add CLI', onClick: () => nav.open(NEW) }}>
        {[...state.tools].sort((a, b) => a.name.localeCompare(b.name)).map((t) => {
          const status = state.toolStatuses.find((s) => s.toolId === t.id && s.machineId === here?.id);
          const r = readiness(here, status);
          return (
            <SettingLink key={t.id} icon={<Wrench />} title={t.name} description={`${t.package}@${t.version} · ${scopeSummary(t.scope, profiles, projects?.projects, spaces)}`} onClick={() => nav.open(t.id)}>
              {here && <span className={`pill ${r.tone}`} title="On this machine"><span className="dot" />{r.label}</span>}
            </SettingLink>
          );
        })}
      </SettingsSection>
    </>
  );
}

export function NewTool({ nav, data }: Props) {
  const tools = data.state!.tools;
  return <ToolForm all={tools} taken={tools.map((t) => t.id)} onSaved={(t) => nav.open(t.id)} onDone={nav.back} />;
}

export function ToolDetail({ nav, data, item: tool }: Props & { item: ToolEntry }) {
  const state = data.state!;
  const here = data.machines?.find((m) => m.thisMachine);
  return (
    <ToolForm tool={tool} all={state.tools} packageDescription={state.toolStatuses.find((s) => s.toolId === tool.id && s.machineId === here?.id)?.description} taken={[]} onSaved={() => {}} onDone={nav.back}
      after={<MachineStatuses tool={tool} machines={data.machines} statuses={state.toolStatuses} onOpenThread={nav.openThread} />} />
  );
}

function MachineStatuses({ tool, machines, statuses, onOpenThread }: { tool: ToolDefinition; machines?: MachineView[]; statuses: ToolStatus[]; onOpenThread: (id: string) => void }) {
  const sorted = [...(machines ?? [])].sort((a, b) => Number(b.thisMachine) - Number(a.thisMachine) || a.name.localeCompare(b.name));
  return (
    <section className="settings-section">
      <h2>Machines</h2>
      {!machines ? <p className="note" role="status">Loading machines…</p> : (
        <div className="tool-cards">
          {sorted.map((m) => (
            <ToolStatusCard key={m.id} heading="machine" tool={tool} machine={m} status={statuses.find((s) => s.toolId === tool.id && s.machineId === m.id)} onOpenThread={onOpenThread} />
          ))}
        </div>
      )}
    </section>
  );
}

const valid = {
  package: (v: string) => ToolDefinition.shape.package.safeParse(v).success,
  version: (v: string) => ToolDefinition.shape.version.safeParse(v).success,
  executable: (v: string) => ToolDefinition.shape.executable.safeParse(v).success,
};

function ToolForm({ tool, all, packageDescription, taken, onSaved, onDone, after }: { tool?: ToolEntry; all: ToolEntry[]; /** What the installed package says it does, on this machine. */ packageDescription?: string; taken: string[]; onSaved: (t: ToolEntry) => void; onDone: () => void; /** Shown between the form and its footer. */ after?: ReactNode }) {
  const client = useClient();
  const { profiles = [], accounts } = useProfiles();
  const { value, dirty, set, reset } = useDraft<Draft>(tool ? { ...tool, description: tool.description ?? '' } : blank());
  // GLOSSARY: CLI. Another CLI with the same executable: where both are on, the narrower level wins.
  const sameExecutable = all.filter((t) => t.id !== tool?.id && t.executable === value.executable.trim());
  const [args, setArgs] = useState<string>();
  const [touched, setTouched] = useState(false);
  const { busy, error, run, attempt } = useAction();
  const argsText = args ?? value.checkArgs.join(' ');
  const checkArgs = argsText.split(/\s+/).filter(Boolean);
  const changed = dirty || (args !== undefined && JSON.stringify(checkArgs) !== JSON.stringify(tool?.checkArgs ?? ['--version']));

  const problems = {
    name: !value.name.trim() ? 'Give the CLI a name.' : undefined,
    package: !valid.package(value.package.trim()) ? 'An npm package name, such as @playwright/cli.' : undefined,
    version: !value.version.trim() ? 'Pin a version, such as 1.2.3.' : !valid.version(value.version.trim()) ? 'Use an exact version, such as 1.2.3.' : undefined,
    executable: !valid.executable(value.executable.trim()) ? 'The command the package installs, such as playwright-cli.' : undefined,
  };
  const invalid = Object.values(problems).some(Boolean);
  const show = (k: keyof typeof problems) => (touched || (value[k] as string) !== '') && problems[k];

  const repairProfile = profiles.find((p) => p.id === value.repairProfileId);
  const repairWarning = value.repairProfileId
    ? repairProfile && !hasSignedInAccount(repairProfile, accounts) ? `${repairProfile.name} isn’t signed in, so a failed check can’t start a repair thread.` : undefined
    : !profiles.some((p) => hasSignedInAccount(p, accounts)) ? 'No profile is signed in yet, so a failed check can’t start a repair thread.' : undefined;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (invalid) return focusFirstInvalid(e.currentTarget);
    const saved = await run(() => client.call('tools.save', {
      ...value,
      id: tool?.id ?? slugId(value.name, taken),
      name: value.name.trim(), package: value.package.trim(), version: value.version.trim(), executable: value.executable.trim(),
      checkArgs, description: value.description?.trim() || undefined, repairProfileId: value.repairProfileId || undefined,
    }));
    if (saved) { reset(); setArgs(undefined); onSaved(saved); }
  };
  const remove = async () => {
    if (tool && (await attempt(() => client.call('tools.delete', { id: tool.id })))) onDone();
  };
  const preset = () => {
    for (const [k, v] of Object.entries(PLAYWRIGHT_CLI)) set(k as keyof Draft, v as never);
    setArgs(undefined);
  };

  return (
    <form className="settings-profile-form" onSubmit={submit} noValidate>
      <SettingsSection>
        <div className="setting-form">
          {!tool && (
            <div className="preset">
              <span className="grow"><b>Playwright CLI</b><small className="hint"> · @playwright/cli@{PLAYWRIGHT_CLI.version}, runs <code>playwright-cli</code></small></span>
              <button type="button" className="ghost" onClick={preset}>Use preset</button>
            </div>
          )}
          <Field label="Name" error={show('name')}>
            {(p) => <input {...p} value={value.name} onChange={(e) => set('name', e.target.value)} placeholder="Playwright CLI" maxLength={120} required autoFocus={!tool} />}
          </Field>
          <div className="field-row">
            <Field label="npm package" className="grow" error={show('package')}>
              {(p) => <input {...p} value={value.package} onChange={(e) => set('package', e.target.value)} placeholder="@playwright/cli" spellCheck={false} required />}
            </Field>
            <Field label="Version" className="version-field" error={show('version')}>
              {(p) => <input {...p} value={value.version} onChange={(e) => set('version', e.target.value)} placeholder="1.2.3, exact" title="An exact version, so every machine runs the same tool" spellCheck={false} required />}
            </Field>
          </div>
          <label className="field" title="Threads see this line next to the CLI's name. Leave it empty to use the package's own description">
            <span>Description</span>
            <input value={value.description ?? ''} onChange={(e) => set('description', e.target.value)} placeholder={packageDescription ?? 'What threads can do with it, such as “Controls the desktop: windows, clicks and screenshots”'} maxLength={300} />
          </label>
          <div className="field-row">
            <Field label="Executable" className="grow" error={show('executable')}>
              {(p) => <input {...p} value={value.executable} onChange={(e) => set('executable', e.target.value)} placeholder="playwright-cli" spellCheck={false} required />}
            </Field>
            <label className="field grow" title="Accio runs the executable with these arguments to check it works">
              <span>Health check arguments</span>
              <input value={argsText} onChange={(e) => setArgs(e.target.value)} placeholder="--version" spellCheck={false} />
            </label>
          </div>
        </div>
      </SettingsSection>
      <SettingsSection title="Levels">
        <div className="setting-form">
          <ScopeEditor name={value.name || 'this CLI'} scope={value.scope} onChange={(scope) => set('scope', scope)} disabled={busy} withSpaces />
          {sameExecutable.length > 0 && (
            <small className="hint" role="status">
              {sameExecutable.map((t) => `${t.name} (${t.package}@${t.version})`).join(', ')} also {sameExecutable.length === 1 ? 'provides' : 'provide'} <code>{value.executable.trim()}</code>. A thread where both are on gets the one at the narrower level.
            </small>
          )}
        </div>
      </SettingsSection>
      <p className="note">Saving installs and checks this CLI on this machine; every other machine installs it on its own.</p>
      <SettingsSection title="Repair">
        <div className="setting-form">
          <div className="field" title="When a check fails, Accio starts a thread on that machine that fixes the install, then checks again">
            <span>Repair threads run as</span>
            <MenuSelect label="Repair threads run as" value={value.repairProfileId ?? ''} onChange={(next) => set('repairProfileId', next || undefined)}
              options={[{ value: '', label: 'Any signed-in profile' }, ...profiles.map((p) => ({ value: p.id, label: p.name, ...(hasSignedInAccount(p, accounts) ? {} : { detail: 'Signed out' }) }))]} />
          </div>
          {repairWarning && <small className="warn" role="status">{repairWarning}</small>}
        </div>
      </SettingsSection>
      {after}
      {error && <p className="error" role="alert">{error}</p>}
      <SettingsFooter remove={tool && { name: tool.name, run: remove, consequence: 'Threads on every machine lose this CLI.' }} busy={busy} onCancel={onDone} saveLabel={tool ? 'Save' : 'Add CLI'} saveDisabled={busy || (!!tool && !changed)} dirty={changed && !busy} />
    </form>
  );
}
