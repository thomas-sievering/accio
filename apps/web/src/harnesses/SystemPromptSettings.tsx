import { useEffect, useState } from 'react';
import type { PromptMeasurement, SystemPromptView } from '@accio/protocol';
import { useClient, useConnectionStatus } from '../app/connection';
import { SettingRow, SettingsSection } from '../app/Settings';
import { PromptSizeBreakdown } from './PromptSizeBreakdown';

/** GLOSSARY: System prompt. Read-only: each section once, labelled with the harnesses that get it. */
export function SystemPromptSettings() {
  const client = useClient();
  const status = useConnectionStatus();
  const [prompt, setPrompt] = useState<SystemPromptView>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (status !== 'open') return;
    let active = true;
    client.call('systemPrompt.get', {}).then(
      (view) => { if (active) { setPrompt(view); setError(undefined); } },
      (err: Error) => { if (active) setError(err.message); },
    );
    return () => { active = false; };
  }, [client, status]);
  const name = (id: string) => prompt?.harnesses.find((h) => h.id === id)?.name ?? id;
  return (
    <>
      <p className="note">Accio adds this to each harness's own instructions on every turn, so it knows how Accio shows its replies. It changes with Accio itself and can't be edited here. <code>{'{harness}'}</code> and <code>{'{model}'}</code> become the harness and model each turn runs on.</p>
      {error && <p className="error">{error}</p>}
      {prompt && (
        <>
          <SettingsSection title="Prompt size">
            <p className="note">Measure each harness with the current built-in tool switches, Accio prompt and standard Accio tools on this machine. The check runs locally without a model call. Project instructions, custom MCP servers and thread additions are excluded; see a thread's Prompt size for its last measured request.</p>
            {prompt.harnesses.map(h => <Baseline key={h.id} harnessId={h.id} name={h.name} />)}
          </SettingsSection>
          <SettingsSection title="How harnesses receive it">
            {prompt.harnesses.map((h) => <SettingRow key={h.id} title={h.name} description={h.delivery} />)}
          </SettingsSection>
          {prompt.sections.map((s) => (
            <SettingsSection key={s.id} title={s.title}>
              {s.variants.map((v) => (
                <div key={v.harnessIds.join()} className="prompt-section">
                  <ul className="prompt-harnesses" aria-label="Sent to">
                    {v.harnessIds.map((id) => <li key={id}>{name(id)}</li>)}
                  </ul>
                  <pre>{v.text}</pre>
                </div>
              ))}
            </SettingsSection>
          ))}
        </>
      )}
    </>
  );
}

function Baseline({ harnessId, name }: { harnessId: string; name: string }) {
  const client = useClient();
  const [measurement, setMeasurement] = useState<PromptMeasurement>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return <div className="prompt-baseline">
    <SettingRow title={name} description="Baseline with current built-in tool settings">
      <button disabled={busy} onClick={async () => {
        setBusy(true); setError(undefined); setMeasurement(undefined);
        try { setMeasurement(await client.call('systemPrompt.measure', { harnessId })); }
        catch (err) { setError((err as Error).message); }
        finally { setBusy(false); }
      }}>{busy ? 'Measuring…' : measurement ? 'Measure again' : 'Measure baseline'}</button>
    </SettingRow>
    {error && <p className="error" role="alert">{error}</p>}
    {measurement && <PromptSizeBreakdown measurement={measurement} />}
  </div>;
}
