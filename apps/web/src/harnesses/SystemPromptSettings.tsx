import { useEffect, useState } from 'react';
import type { SystemPromptView } from '@accio/protocol';
import { useClient, useConnectionStatus } from '../app/connection';
import { SettingRow, SettingsSection } from '../app/Settings';
import './harnesses.css';

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
