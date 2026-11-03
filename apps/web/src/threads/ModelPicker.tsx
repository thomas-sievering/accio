import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { modelKey, type ModelSelection, type ModelsState } from '@accio/protocol';
import { useClient, useConnectionStatus } from '../app/connection';

/** A profile-scoped picker: favourites first, then each provider/harness pair. */
export function ModelPicker({ profileId, value, onChange, disabled = false }: {
  profileId?: string;
  value: ModelSelection;
  onChange: (model: ModelSelection) => Promise<void>;
  disabled?: boolean;
}) {
  const client = useClient();
  const status = useConnectionStatus();
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState<{ profileId: string; state: ModelsState }>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('favorites');
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState<CSSProperties>({});
  const data = loaded && loaded.profileId === profileId ? loaded.state : undefined;

  useEffect(() => {
    if (!profileId || status !== 'open') return;
    let active = true;
    let revision = 0;
    const refresh = () => {
      const request = ++revision;
      void client.call('models.list', { profileId }).then((state) => {
        if (active && request === revision) { setLoaded({ profileId, state }); setError(undefined); }
      }, (err: Error) => { if (active && request === revision) setError(err.message); });
    };
    refresh();
    const off = [client.onEvent('models.changed', refresh), client.onEvent('profiles.changed', refresh)];
    return () => { active = false; off.forEach((stop) => stop()); };
  }, [client, status, profileId]);

  useEffect(() => {
    setTab('favorites');
    setQuery('');
    setError(undefined);
    panel.current?.hidePopover();
  }, [profileId]);

  const models = data?.models ?? [];
  const favorites = new Set(data?.favorites.map(modelKey));
  const groups = [...new Map(models.map((m) => [JSON.stringify([m.providerId, m.harnessId]), {
    id: JSON.stringify([m.providerId, m.harnessId]), provider: m.providerName, harness: m.harnessName,
  }])).values()];
  const activeTab = tab === 'favorites' || groups.some((g) => g.id === tab) ? tab : 'favorites';
  const selected = models.find((m) => m.harnessId === value.harnessId && m.id === value.modelId);
  const visible = models.filter((m) => {
    const inTab = activeTab === 'favorites' ? favorites.has(modelKey({ harnessId: m.harnessId, modelId: m.id })) : JSON.stringify([m.providerId, m.harnessId]) === activeTab;
    return inTab && `${m.name} ${m.providerName} ${m.harnessName}`.toLowerCase().includes(query.toLowerCase().trim());
  });
  const choose = async (model: ModelSelection) => {
    setBusy(true);
    setError(undefined);
    try { await onChange(model); panel.current?.hidePopover(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  const favorite = async (model: ModelSelection, next: boolean) => {
    if (!profileId) return;
    setBusy(true);
    setError(undefined);
    try {
      const state = await client.call('models.favorite', { profileId, model, favorite: next });
      setLoaded({ profileId, state });
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  const move = (event: KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...(panel.current?.querySelectorAll<HTMLButtonElement>('[data-model-choice]') ?? [])];
    if (!buttons.length) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  return <>
    <button type="button" className="model-trigger" popoverTarget={id} disabled={disabled || busy || !profileId || status !== 'open'} aria-label={`Select model: ${selected?.name ?? 'Claude Code default'}`}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const width = Math.min(520, window.innerWidth - 24);
        const above = rect.top >= 260;
        setPosition({ width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
          ...(above ? { bottom: window.innerHeight - rect.top + 8, top: 'auto', maxHeight: rect.top - 20 } : { top: rect.bottom + 8, bottom: 'auto', maxHeight: window.innerHeight - rect.bottom - 20 }) });
      }}>
      {selected?.name ?? (value.modelId === 'default' ? 'Claude Code default' : `Claude ${value.modelId}`)} <span aria-hidden="true">⌄</span>
    </button>
    <div id={id} ref={panel} popover="auto" className="model-picker" style={position} role="dialog" aria-label="Choose a model"
      onToggle={(event) => { if (event.newState === 'open') { setQuery(''); search.current?.focus(); } }}>
      <div className="model-picker-search">
        <input ref={search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search models…" aria-label="Search models"
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') move(event);
            if (event.key === 'Enter') {
              event.preventDefault();
              const first = visible[0];
              if (first && !busy && !disabled) void choose({ harnessId: first.harnessId, modelId: first.id });
            }
          }} />
      </div>
      <div className="model-picker-body">
        <nav className="model-picker-tabs" aria-label="Model groups">
          <button type="button" aria-pressed={activeTab === 'favorites'} onClick={() => setTab('favorites')}>★ Favourites</button>
          {groups.map((group) => <button type="button" key={group.id} aria-pressed={activeTab === group.id} onClick={() => setTab(group.id)}>
            {group.provider}<small>{group.harness}</small>
          </button>)}
        </nav>
        <div className="model-picker-models" onKeyDown={move} aria-busy={busy}>
          {!data && !error && <p className="model-picker-empty">Loading models…</p>}
          {data && models.length === 0 && <p className="model-picker-empty">No models are available. Sign this profile in with a supported provider.</p>}
          {models.length > 0 && visible.length === 0 && <p className="model-picker-empty">{query ? 'No matching models.' : 'Star models in a provider tab to see them here.'}</p>}
          {visible.map((m) => {
            const choice = { harnessId: m.harnessId, modelId: m.id };
            const key = modelKey(choice);
            const isSelected = modelKey(value) === key;
            return <div className={`model-picker-row${isSelected ? ' selected' : ''}`} key={key}>
              <button type="button" data-model-choice disabled={busy || disabled} aria-pressed={isSelected} onClick={() => void choose(choice)}>
                <span className="model-picker-name">{m.name}{isSelected && <span aria-label="Selected">✓</span>}</span>
                <small>{m.description}</small>
                {activeTab === 'favorites' && <small>{m.providerName} · {m.harnessName}</small>}
              </button>
              <button type="button" className="model-star" disabled={busy} aria-label={`${favorites.has(key) ? 'Remove' : 'Add'} ${m.name} ${favorites.has(key) ? 'from' : 'to'} favourites`} aria-pressed={favorites.has(key)} onClick={() => void favorite(choice, !favorites.has(key))}>
                {favorites.has(key) ? '★' : '☆'}
              </button>
            </div>;
          })}
        </div>
      </div>
      {error && <p className="error model-picker-error" role="alert">{error}</p>}
    </div>
  </>;
}
