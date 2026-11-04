import { useEffect, useState } from 'react';
import { modelKey, type ModelView, type ThreadNamingSettings } from '@accio/protocol';
import { useClient, useConnectionStatus } from '../app/connection';
import { SettingRow, SettingsSection } from '../app/Settings';
import { useAction } from '../app/useAction';
import { useProfiles } from '../profiles/profiles';
import { useThreads } from './threads';
import { MenuSelect } from '../ui/MenuSelect';

export function NamingSettings() {
  const client = useClient();
  const status = useConnectionStatus();
  const { profiles } = useProfiles();
  const { threads } = useThreads();
  const [settings, setSettings] = useState<ThreadNamingSettings>();
  const [models, setModels] = useState<ModelView[]>([]);
  const [loadError, setLoadError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [threadId, setThreadId] = useState('');
  const [example, setExample] = useState<string>();
  const { busy, error, run } = useAction();
  useEffect(() => {
    if (status !== 'open') return;
    let active = true;
    client.call('threadNaming.get', {}).then(value => { if (active) { setSettings(value); setLoadError(undefined); } }, err => { if (active) setLoadError(err.message); });
    return () => { active = false; };
  }, [client, status]);
  useEffect(() => {
    if (status !== 'open' || !profiles) return;
    let active = true;
    const load = () => void Promise.all(profiles.map(profile => client.call('models.list', { profileId: profile.id }))).then(lists => {
      if (active) setModels([...new Map(lists.flatMap(list => list.models).map(model => [modelKey({ harnessId: model.harnessId, modelId: model.id }), model])).values()]);
    }, err => { if (active) setLoadError(err.message); });
    load();
    const off = client.onEvent('models.changed', load);
    return () => { active = false; off(); };
  }, [client, status, profiles]);
  const edit = (patch: Partial<ThreadNamingSettings>) => { setSettings(value => value && { ...value, ...patch }); setSaved(false); setExample(undefined); };
  const modelValue = settings?.model ? modelKey(settings.model) : '';
  const selectedThread = threadId || threads?.[0]?.id || '';
  return <>
    <p className="note">Titles appear automatically after your first message and stay stable as work progresses. Titles you edit yourself are kept.</p>
    {loadError && <p className="error" role="alert">{loadError}</p>}
    {settings && <form onSubmit={event => { event.preventDefault(); void run(async () => { setSettings(await client.call('threadNaming.save', settings)); setSaved(true); }); }}>
      <SettingsSection title="Thread naming">
        <SettingRow title="Automatically name new threads" description="Uses a separate, short request without delaying your agent.">
          <input aria-label="Automatically name new threads" type="checkbox" checked={settings.automatic} disabled={busy} onChange={event => edit({ automatic: event.target.checked })} />
        </SettingRow>
        <SettingRow title="Naming model" description="Automatic uses a lightweight model from the thread’s provider. A chosen model must be available to the thread’s profile; otherwise the first line stays as its title.">
          <div className="field naming-model"><MenuSelect label="Naming model" value={modelValue} disabled={busy} onChange={value => {
            const model = models.find(model => modelKey({ harnessId: model.harnessId, modelId: model.id }) === value);
            edit({ model: model ? { harnessId: model.harnessId, modelId: model.id, ...(model.efforts[0] ? { effort: model.efforts[0].id } : {}) } : null });
          }} options={[
            { value: '', label: 'Automatic', detail: 'Fast, low-cost model' },
            ...(settings.model && !models.some(model => modelKey({ harnessId: model.harnessId, modelId: model.id }) === modelValue) ? [{ value: modelValue, label: settings.model.modelId, detail: 'Unavailable' }] : []),
            ...models.map(model => ({ value: modelKey({ harnessId: model.harnessId, modelId: model.id }), label: model.name, detail: model.harnessName })),
          ]} /></div>
        </SettingRow>
      </SettingsSection>
      <details className="naming-advanced">
        <summary>Advanced</summary>
        <label className="field naming-instructions"><span>Naming instructions</span>
          <textarea rows={4} maxLength={2000} value={settings.instructions} disabled={busy} onChange={event => edit({ instructions: event.target.value })} placeholder="Use sentence case. Lead with the affected feature. Avoid project names." />
        </label>
        <p className="note">Appended to the built-in naming prompt for new and regenerated titles. Existing titles stay unchanged.</p>
        <button type="button" className="ghost" disabled={busy || !settings.instructions} onClick={() => edit({ instructions: '' })}>Reset instructions</button>
        <div className="naming-preview">
          <div className="field"><span>Example thread</span><MenuSelect label="Example thread" value={selectedThread} disabled={busy || !threads?.length}
            placeholder={threads?.length ? 'Choose a thread' : 'Send a message to start a thread first'}
            onChange={value => { setThreadId(value); setExample(undefined); }}
            options={threads?.map(thread => ({ value: thread.id, label: thread.title })) ?? []} /></div>
          <button type="button" className="ghost" disabled={busy || !selectedThread} onClick={() => void run(async () => {
            const result = await client.call('threads.previewTitle', { threadId: selectedThread, instructions: settings.instructions, model: settings.model });
            setExample(result.title);
          })}>Try instructions</button>
        </div>
        {example && <p role="status">Example title: <b>{example}</b></p>}
      </details>
      <button type="submit" className="ghost primary" disabled={busy}>{busy ? 'Working…' : 'Save naming settings'}</button>
      {saved && <p role="status" className="note">Naming settings saved</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </form>}
  </>;
}
