import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { modelKey, type ModelSelection, type ModelsState } from '@accio/protocol';
import { useClient, useConnectionStatus } from '../app/connection';
import { Check, ProviderLogo, Star } from '../app/icons';
import { Meter, effortSteps } from './EffortControl';
import { choiceDetail, presetSteps, usedUpText } from './PresetControl';
import { StepSlider, useSteps, useWheelSteps } from './steps';

/**
 * GLOSSARY: Preset, Effort. One chip for what a thread runs: the preset level when the
 * model and effort are one, else the model and an effort meter. Scrolling over it steps
 * presets. Its panel has the preset slider, the profile's models (favourites first,
 * then each provider/harness pair) and the effort slider.
 */
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
  const trigger = useRef<HTMLButtonElement>(null);
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

  // Presets never cross harnesses: a thread's are its own harness's, a draft's those of the model it has.
  const presets = (data?.presets ?? []).filter((p) => p.harnessId === (harnessId ?? current.harnessId));
  const preset = presetSteps(presets, models, current);
  const presetStepper = useSteps(preset.steps, preset.index, onChange, setError);
  useWheelSteps(trigger, presetStepper.step);
  const effort = selected && selected.efforts.length > 0 ? effortSteps(selected, current.effort) : undefined;
  const effortStepper = useSteps(effort?.steps ?? [], effort?.index ?? -1,
    (next) => onChange({ harnessId: current.harnessId, modelId: current.modelId, ...(next ? { effort: next } : {}) }), setError);
  const shownPreset = presets[presetStepper.shown];
  const description = shownPreset ? `${preset.steps[presetStepper.shown]!.label} preset · ${choiceDetail(shownPreset.model, models)}` : choiceDetail(current, models);

  return <span className="model-choice">
    <button type="button" ref={trigger} className={`model-trigger${shownPreset ? ` on-preset tone-${shownPreset.level}` : ` tone-${effort?.tone(effortStepper.shown) ?? 'none'}`}`} popoverTarget={id}
      disabled={disabled || busy || !profileId || status !== 'open'} aria-label={`Select model: ${description}`} title={`${description}${presets.length ? ' · scroll to change preset' : ''}`}
      onKeyDown={(event) => {
        if (!presets.length) return;
        if (event.key === 'ArrowUp') { event.preventDefault(); presetStepper.step(1); }
        if (event.key === 'ArrowDown') { event.preventDefault(); presetStepper.step(-1); }
      }}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const width = Math.min(340, window.innerWidth - 24);
        const above = rect.top >= window.innerHeight - rect.bottom;
        const room = (above ? rect.top : window.innerHeight - rect.bottom) - 20;
        // One height for every tab: the longest list or the rail, whichever is taller, plus the sliders.
        const longest = Math.max(favorites.size * 33, ...groups.map((g) => models.filter((m) => JSON.stringify([m.providerId, m.harnessId]) === g.id).length * 33));
        const sliders = (presets.length ? 96 : 0) + (effort ? 76 : 0);
        const height = Math.min(Math.max(longest + 14, (groups.length + 1) * 40 + 12, 172) + sliders, 560, room);
        setPosition({ width, height, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
          ...(above ? { bottom: window.innerHeight - rect.top + 8, top: 'auto' } : { top: rect.bottom + 8, bottom: 'auto' }) });
      }}>
      <span key={presetStepper.bump} className={presetStepper.bump ? 'model-trigger-content bumped' : 'model-trigger-content'}>
        {shownPreset ? <><i className="preset-dot" aria-hidden />{preset.steps[presetStepper.shown]!.label}</> : <>
          <ProviderLogo providerId={selected?.providerId ?? (value.harnessId === 'codex' ? 'openai' : 'anthropic')} />
          <span>{shortName}</span>
          {effort && <Meter levels={effort.levels} filled={effort.filled(effortStepper.shown)} />}
        </>}
      </span>
    </button>
    <div id={id} ref={panel} popover="auto" className="model-picker" style={position} role="dialog" aria-label="Choose a model"
      onKeyDown={(event) => { if (!(event.target instanceof HTMLInputElement)) move(event); }}
      onToggle={(event) => {
        if (event.newState !== 'open') return;
        setTab(openingTab());
        // With presets, the arrow keys step them straight away; Tab reaches the models.
        if (presets.length) requestAnimationFrame(() => panel.current?.querySelector<HTMLInputElement>('input[aria-label="Preset"]')?.focus());
        else focusRow();
      }}>
      {presets.length > 0 && <StepSlider name="Preset" steps={preset.steps} shown={presetStepper.shown} settle={presetStepper.settle}
        tone={preset.tone(presetStepper.shown)} detail={shownPreset ? choiceDetail(shownPreset.model, models) : 'Your own model and effort'} />}
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
          return <div className={`model-picker-row${isSelected ? ' selected' : ''}${m.limited ? ' limited' : ''}`} key={key} title={m.limited ? usedUpText(m.limited) : undefined}>
            <button type="button" data-model-choice aria-pressed={isSelected} onClick={() => void choose(choice)}>
              {/* Favourites mix providers, so each row carries its provider's logo instead of the full name. */}
              <span className="model-picker-name">{activeTab === 'favorites' ? <><ProviderLogo providerId={m.providerId} />{short(m.name)}</> : m.name}{m.isDefault && <span className="model-picker-badge">Default</span>}</span>
              {m.limited && <small className="model-picker-limited">{usedUpText(m.limited)}</small>}
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
      {effort && <StepSlider name="Effort" steps={effort.steps} shown={effortStepper.shown} settle={effortStepper.settle} tone={effort.tone(effortStepper.shown)} />}
      {error && <p className="error model-picker-error" role="alert">{error}</p>}
    </div>
  </span>;
}

/** The provider logo already names the brand, so a name beside it drops the "Claude " prefix. */
function short(name: string): string {
  return name.replace(/^Claude\s+/, '').replace(/^./, (c) => c.toUpperCase());
}
