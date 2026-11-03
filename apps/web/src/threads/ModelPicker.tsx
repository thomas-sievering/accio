import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { modelKey, type ModelSelection, type ModelsState } from '@accio/protocol';
import { useClient, useConnectionStatus } from '../app/connection';
import { Check, ProviderLogo, Star } from '../app/icons';
import { EffortControl } from './EffortControl';

/** A profile-scoped picker: favourites first, then each provider/harness pair. */
export function ModelPicker({ profileId, harnessId, value, onChange, disabled = false }: {
  profileId?: string;
  harnessId?: string;
  value: ModelSelection;
  onChange: (model: ModelSelection) => Promise<void>;
  disabled?: boolean;
}) {
  const client = useClient();
  const status = useConnectionStatus();
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<{ profileId: string; state: ModelsState }>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('favorites');
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
    setError(undefined);
    panel.current?.hidePopover();
  }, [profileId]);

  const models = (data?.models ?? []).filter((m) => !harnessId || m.harnessId === harnessId);
  const fallbackName = value.modelId === 'default' ? `${value.harnessId === 'codex' ? 'Codex' : 'Claude Code'} default` : value.modelId;
  const favorites = new Set(data?.favorites.map(modelKey));
  const groups = [...new Map(models.map((m) => [JSON.stringify([m.providerId, m.harnessId]), {
    id: JSON.stringify([m.providerId, m.harnessId]), providerId: m.providerId, provider: m.providerName, harness: m.harnessName,
  }])).values()];
  const activeTab = tab === 'favorites' || groups.some((g) => g.id === tab) ? tab : 'favorites';
  // Codex's 'default' is no longer listed; it stands for the account's default model.
  const current = value.harnessId === 'codex' && value.modelId === 'default'
    ? { harnessId: 'codex', modelId: models.find((m) => m.harnessId === 'codex' && m.isDefault)?.id ?? 'default' } : value;
  const selected = models.find((m) => m.harnessId === current.harnessId && m.id === current.modelId);
  const shortName = short(selected?.name ?? fallbackName);
  const visible = models.filter((m) => activeTab === 'favorites'
    ? favorites.has(modelKey({ harnessId: m.harnessId, modelId: m.id }))
    : JSON.stringify([m.providerId, m.harnessId]) === activeTab);
  // Open where the choice is likeliest: favourites if there are any, else the current model's provider.
  const openingTab = () => favorites.size > 0 ? 'favorites'
    : selected ? JSON.stringify([selected.providerId, selected.harnessId]) : groups[0]?.id ?? 'favorites';
  const focusRow = () => requestAnimationFrame(() => {
    const rows = panel.current?.querySelectorAll<HTMLButtonElement>('[data-model-choice]');
    (panel.current?.querySelector<HTMLButtonElement>('[data-model-choice][aria-pressed="true"]') ?? rows?.[0])?.focus();
  });
  // Buttons stay enabled while a call runs so keyboard focus never drops out of the panel.
  const choose = async (model: ModelSelection) => {
    if (busy || disabled) return;
    setBusy(true);
    setError(undefined);
    // Another model keeps the effort when it accepts it, so moving from Opus to Sonnet stays at high.
    const next = models.find((m) => m.harnessId === model.harnessId && m.id === model.modelId);
    const effort = value.effort && next?.efforts.some((e) => e.id === value.effort) ? value.effort : undefined;
    try { await onChange(effort ? { ...model, effort } : model); panel.current?.hidePopover(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  const favorite = async (model: ModelSelection, next: boolean) => {
    if (!profileId || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const state = await client.call('models.favorite', { profileId, model, favorite: next });
      setLoaded({ profileId, state });
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  const switchTab = (step: number) => {
    const tabs = ['favorites', ...groups.map((g) => g.id)];
    setTab(tabs[(tabs.indexOf(activeTab) + step + tabs.length) % tabs.length]!);
    focusRow();
  };
  const move = (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); switchTab(event.key === 'ArrowRight' ? 1 : -1); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...(panel.current?.querySelectorAll<HTMLButtonElement>('[data-model-choice]') ?? [])];
    if (!buttons.length) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  return <span className="model-choice">
    <button type="button" className="model-trigger" popoverTarget={id} disabled={disabled || busy || !profileId || status !== 'open'} aria-label={`Select model: ${selected?.name ?? fallbackName}`}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const width = Math.min(340, window.innerWidth - 24);
        const above = rect.top >= window.innerHeight - rect.bottom;
        const room = (above ? rect.top : window.innerHeight - rect.bottom) - 20;
        // One height for every tab: the longest list or the rail, whichever is taller.
        const longest = Math.max(favorites.size * 33, ...groups.map((g) => models.filter((m) => JSON.stringify([m.providerId, m.harnessId]) === g.id).length * 33));
        const height = Math.min(Math.max(longest + 14, (groups.length + 1) * 40 + 12, 172), 420, room);
        setPosition({ width, height, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
          ...(above ? { bottom: window.innerHeight - rect.top + 8, top: 'auto' } : { top: rect.bottom + 8, bottom: 'auto' }) });
      }}>
      <ProviderLogo providerId={selected?.providerId ?? (value.harnessId === 'codex' ? 'openai' : 'anthropic')} />
      <span>{shortName}</span>
    </button>
    <div id={id} ref={panel} popover="auto" className="model-picker" style={position} role="dialog" aria-label="Choose a model" onKeyDown={move}
      onToggle={(event) => { if (event.newState === 'open') { setTab(openingTab()); focusRow(); } }}>
      <nav className="model-picker-tabs" aria-label="Model groups">
        <button type="button" className="favorite" aria-pressed={activeTab === 'favorites'} aria-label="Favourites" title="Favourites" onClick={() => setTab('favorites')}>
          <Star filled />
        </button>
        {groups.map((group) => <button type="button" key={group.id} aria-pressed={activeTab === group.id} aria-label={`${group.provider} · ${group.harness}`} title={`${group.provider} · ${group.harness}`} onClick={() => setTab(group.id)}>
          <ProviderLogo providerId={group.providerId} />
        </button>)}
      </nav>
      <div className="model-picker-models" aria-busy={busy}>
        {!data && !error && <p className="model-picker-empty">Loading models…</p>}
        {data && models.length === 0 && <p className="model-picker-empty">No models are available. Sign this profile in with a supported provider.</p>}
        {models.length > 0 && visible.length === 0 && <div className="model-picker-empty">
          <span className="model-picker-empty-icon"><Star /></span>
          <b>No favourites yet</b>
          <span>Star a model in a provider tab to pin it here.</span>
        </div>}
        {visible.map((m) => {
          const choice = { harnessId: m.harnessId, modelId: m.id };
          const key = modelKey(choice);
          const isSelected = modelKey(current) === key;
          const isFavorite = favorites.has(key);
          return <div className={`model-picker-row${isSelected ? ' selected' : ''}`} key={key}>
            <button type="button" data-model-choice aria-pressed={isSelected} onClick={() => void choose(choice)}>
              {/* Favourites mix providers, so each row carries its provider's logo instead of the full name. */}
              <span className="model-picker-name">{activeTab === 'favorites' ? <><ProviderLogo providerId={m.providerId} />{short(m.name)}</> : m.name}{m.isDefault && <span className="model-picker-badge">Default</span>}</span>
            </button>
            <button type="button" className="model-star" title={isFavorite ? 'Remove from favourites' : 'Add to favourites'}
              aria-label={`${isFavorite ? 'Remove' : 'Add'} ${m.name} ${isFavorite ? 'from' : 'to'} favourites`} aria-pressed={isFavorite}
              onClick={() => void favorite(choice, !isFavorite)}>
              <Star filled={isFavorite} />
            </button>
            <span className="model-picker-check" aria-hidden>{isSelected && <Check />}</span>
          </div>;
        })}
      </div>
      {error && <p className="error model-picker-error" role="alert">{error}</p>}
    </div>
    {selected && selected.efforts.length > 0 && <EffortControl key={modelKey(current)} model={selected} value={current.effort} disabled={disabled || !profileId || status !== 'open'}
      onChange={(effort) => onChange({ harnessId: current.harnessId, modelId: current.modelId, ...(effort ? { effort } : {}) })} />}
  </span>;
}

/** The provider logo already names the brand, so a name beside it drops the "Claude " prefix. */
function short(name: string): string {
  return name.replace(/^Claude\s+/, '').replace(/^./, (c) => c.toUpperCase());
}
