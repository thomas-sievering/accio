import { useEffect, useState } from 'react';
import type { HarnessView, PresetView } from '@accio/protocol';
import { useClient, useConnectionStatus } from '../app/connection';
import { useLive } from '../app/useLive';
import { SettingRow, SettingsSection } from '../app/Settings';
import { effortName } from '../threads/EffortControl';

/** Shared harness catalogue and the installations each machine reports. */
export function HarnessesSettings() {
  const client = useClient();
  const status = useConnectionStatus();
  const machines = useLive(() => client.call('machines.list', {}), 'machines.changed');
  const [harnesses, setHarnesses] = useState<HarnessView[]>();
  const [error, setError] = useState<string>();
  // Presets and the models offered change with every profile's sign-ins, not only with machines.
  const [revision, setRevision] = useState(0);
  useEffect(() => client.onEvent('models.changed', () => setRevision((n) => n + 1)), [client]);
  useEffect(() => {
    if (status !== 'open') return;
    let active = true;
    client.call('harnesses.list', {}).then(
      (list) => { if (active) { setHarnesses(list); setError(undefined); } },
      (err: Error) => { if (active) setError(err.message); },
    );
    return () => { active = false; };
  }, [client, status, machines, revision]);
  return (
    <>
      <p className="note">Harnesses run your threads. Each uses models from the providers listed below.</p>
      {error && <p className="error">{error}</p>}
      {harnesses?.map((h) => (
        <SettingsSection key={h.id} title={h.name}>
          <SettingRow title="Providers"><span>{h.providers.map((p) => p === 'anthropic' ? 'Anthropic' : 'OpenAI').join(', ')}</span></SettingRow>
          <SettingRow title="Models" description={h.id === 'codex' ? 'Available models come from the signed-in ChatGPT account.' : "Model aliases follow Claude Code's current versions."}><span>{h.models.length ? h.models.map((m) => m.name).join(', ') : 'Per account'}</span></SettingRow>
          {h.presets.length > 0 && <SettingRow title="Presets" description="The levels you step through in the composer. Each sets a model and effort." />}
          {h.presets.map((preset) => <PresetRow key={preset.level} harness={h} preset={preset} onError={setError} />)}
          {h.machines.length === 0 && <SettingRow title="No installations reported" />}
          {h.machines.map((install) => {
            const machine = machines?.find((m) => m.id === install.machineId);
            return (
              <SettingRow key={install.machineId} title={machine?.name ?? install.machineId} description={machine?.connected ? 'Connected' : 'Offline'}>
                <code>{install.version ?? 'Version unknown'}</code>
              </SettingRow>
            );
          })}
        </SettingsSection>
      ))}
    </>
  );
}

const LEVELS = { low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra' } as const;

/** GLOSSARY: Preset. One level of a harness: the model and effort it stands for, shared by every profile. */
function PresetRow({ harness, preset, onError }: { harness: HarnessView; preset: PresetView; onError: (message: string | undefined) => void }) {
  const client = useClient();
  const model = harness.models.find((m) => m.id === preset.model.modelId);
  const save = async (choice: { modelId: string; effort?: string } | null) => {
    onError(undefined);
    try { await client.call('presets.save', { harnessId: harness.id, level: preset.level, choice }); }
    catch (err) { onError((err as Error).message); }
  };
  return (
    // The level's dot matches the composer chip; a changed level is the one with Reset.
    <SettingRow title={<span className={`preset-setting-title tone-${preset.level}`}><i className="preset-dot" aria-hidden />{LEVELS[preset.level]}</span>}>
      <span className="preset-setting">
        <select aria-label={`${LEVELS[preset.level]} preset model`} value={preset.model.modelId} onChange={(e) => {
          const next = harness.models.find((m) => m.id === e.target.value);
          // Keep the effort when the new model accepts it.
          const effort = preset.model.effort && next?.efforts.some((x) => x.id === preset.model.effort) ? preset.model.effort : undefined;
          void save({ modelId: e.target.value, ...(effort ? { effort } : {}) });
        }}>
          {harness.models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        {model && model.efforts.length > 0 && <select aria-label={`${LEVELS[preset.level]} preset effort`} value={preset.model.effort ?? ''}
          onChange={(e) => void save({ modelId: preset.model.modelId, ...(e.target.value ? { effort: e.target.value } : {}) })}>
          <option value="">{model.defaultEffort ? `Default (${effortName(model.defaultEffort)})` : 'Auto'}</option>
          {model.efforts.map((x) => <option key={x.id} value={x.id}>{effortName(x.id)}</option>)}
        </select>}
        {preset.custom && <button type="button" className="link" title="Use the default for this level again" onClick={() => void save(null)}>Reset</button>}
      </span>
    </SettingRow>
  );
}
