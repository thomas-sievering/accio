import { useState, type FormEvent, type ReactNode } from 'react';
import { ToolDefinition, type MachineView, type ToolStatus } from '@accio/protocol';
import { useClient } from '../app/connection';
import { Plus, Wrench } from '../app/icons';
import { SettingLink, SettingsFooter, SettingsSection } from '../app/Settings';
import { useAction } from '../app/useAction';
import { useLive } from '../app/useLive';
import { hasSignedInAccount, useProfiles } from '../profiles/profiles';
import { LoadError, slugId, useDraft, useResources } from '../resources/resources';
import { Field, focusFirstInvalid } from '../resources/Field';
import { readiness, ToolStatusCard } from './ToolStatusCard';

/** `npm view @playwright/cli version` on 2026-11-03. Editable before saving. */
const PLAYWRIGHT_CLI = { name: 'Playwright CLI', package: '@playwright/cli', version: '0.1.23', executable: 'playwright-cli', checkArgs: ['--version'] };

type Draft = Omit<ToolDefinition, 'id'> & { id: string };
const blank = (): Draft => ({ id: '', name: '', package: '', version: '', executable: '', checkArgs: ['--version'], repairProfileId: undefined });

/** Command-line tools the hub installs with npm into a managed folder on each machine. */
export function ToolsSettings({ toolId, onOpen, onBack, onOpenThread }: { toolId?: string; onOpen: (id: string) => void; onBack: () => void; onOpenThread: (id: string) => void }) {
  const client = useClient();
  const { state, loadError, retry } = useResources();
  const machines = useLive(() => client.call('machines.list', {}), 'machines.changed');
  if (!state) return loadError ? <LoadError error={loadError} retry={retry} /> : <p className="note" role="status">Loading tools…</p>;
  if (toolId === 'new') return <ToolForm taken={state.tools.map((t) => t.id)} onSaved={(t) => onOpen(t.id)} onDone={onBack} />;
  const tool = state.tools.find((t) => t.id === toolId);
  if (toolId && !tool) return <><p className="note">This tool was deleted.</p><button className="link" onClick={onBack}>All tools</button></>;
  if (tool) {
    return (
      <ToolForm key={tool.id} tool={tool} taken={[]} onSaved={() => {}} onDone={onBack}
        after={<MachineStatuses tool={tool} machines={machines} statuses={state.toolStatuses} onOpenThread={onOpenThread} />} />
    );
  }
  const here = machines?.find((m) => m.thisMachine);
  return (
    <>
      <p className="note">Managed npm tools. Accio installs each tool’s exact version into its own folder on every machine, checks it, and adds it to every thread’s PATH on that machine. A failed check starts a repair thread.</p>
      <SettingsSection>
        {[...state.tools].sort((a, b) => a.name.localeCompare(b.name)).map((t) => {
          const status = state.toolStatuses.find((s) => s.toolId === t.id && s.machineId === here?.id);
          const r = readiness(here, status);
          return (
            <SettingLink key={t.id} icon={<Wrench />} title={t.name} description={`${t.package}@${t.version}`} onClick={() => onOpen(t.id)}>
              {here && <span className={`pill ${r.tone}`} title="On this machine"><span className="dot" />{r.label}</span>}
            </SettingLink>
          );
        })}
        <SettingLink icon={<Plus />} title="Add tool" description="An npm package pinned to an exact version." chevron={false} onClick={() => onOpen('new')} />
      </SettingsSection>
    </>
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

function ToolForm({ tool, taken, onSaved, onDone, after }: { tool?: ToolDefinition; taken: string[]; onSaved: (t: ToolDefinition) => void; onDone: () => void; /** Shown between the form and its footer. */ after?: ReactNode }) {
  const client = useClient();
  const { profiles = [] } = useProfiles();
  const { value, dirty, set, reset } = useDraft<Draft>(tool ?? blank());
  const [args, setArgs] = useState<string>();
  const [touched, setTouched] = useState(false);
  const { busy, error, run } = useAction();
  const argsText = args ?? value.checkArgs.join(' ');
  const checkArgs = argsText.split(/\s+/).filter(Boolean);
  const changed = dirty || (args !== undefined && JSON.stringify(checkArgs) !== JSON.stringify(tool?.checkArgs ?? ['--version']));

  const problems = {
    name: !value.name.trim() ? 'Give the tool a name.' : undefined,
    package: !valid.package(value.package.trim()) ? 'An npm package name, such as @playwright/cli.' : undefined,
    version: !value.version.trim() ? 'Pin a version, such as 1.2.3.' : !valid.version(value.version.trim()) ? 'Use an exact version, such as 1.2.3.' : undefined,
    executable: !valid.executable(value.executable.trim()) ? 'The command the package installs, such as playwright-cli.' : undefined,
  };
  const invalid = Object.values(problems).some(Boolean);
  const show = (k: keyof typeof problems) => (touched || (value[k] as string) !== '') && problems[k];

  const repairProfile = profiles.find((p) => p.id === value.repairProfileId);
  const repairWarning = value.repairProfileId
    ? repairProfile && !hasSignedInAccount(repairProfile) ? `${repairProfile.name} isn’t signed in, so a failed check can’t start a repair thread.` : undefined
    : !profiles.some(hasSignedInAccount) ? 'No profile is signed in yet, so a failed check can’t start a repair thread.' : undefined;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (invalid) return focusFirstInvalid(e.currentTarget);
    const saved = await run(() => client.call('tools.save', {
      ...value,
      id: tool?.id ?? slugId(value.name, taken),
      name: value.name.trim(), package: value.package.trim(), version: value.version.trim(), executable: value.executable.trim(),
      checkArgs, repairProfileId: value.repairProfileId || undefined,
    }));
    if (saved) { reset(); setArgs(undefined); onSaved(saved); }
  };
  const remove = async () => {
    if (tool && (await run(async () => (await client.call('tools.delete', { id: tool.id }), true)))) onDone();
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
      <p className="note">Saving installs and checks this tool on this machine. Managed tools are available to every profile and project on the machine.</p>
      <SettingsSection title="Repair">
        <div className="setting-form">
          <label className="field" title="When a check fails, Accio starts a thread on that machine that fixes the install, then checks again">
            <span>Repair threads run as</span>
            <select value={value.repairProfileId ?? ''} onChange={(e) => set('repairProfileId', e.target.value || undefined)}>
              <option value="">Any signed-in profile</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}{hasSignedInAccount(p) ? '' : ' · Signed out'}</option>)}
            </select>
          </label>
          {repairWarning && <small className="warn" role="status">{repairWarning}</small>}
        </div>
      </SettingsSection>
      {after}
      {error && <p className="error" role="alert">{error}</p>}
      <SettingsFooter remove={tool && { name: tool.name, run: remove, consequence: 'Threads on every machine lose this tool.' }} busy={busy} onCancel={onDone} saveLabel={tool ? 'Save' : 'Add tool'} saveDisabled={busy || (!!tool && !changed)} dirty={changed && !busy} />
    </form>
  );
}
