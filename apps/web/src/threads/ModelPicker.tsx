import { useEffect, useId, useState } from 'react';
import { modelKey, type ModelSelection, type UsedUpLimit, harnessName, harnessProvider } from '@accio/protocol';
import { useClient, useConnectionStatus } from '../app/connection';
import { Check, ProviderLogo, Star } from '../app/icons';
import { useAction } from '../app/useAction';
import { EffortWord, effortSteps } from './EffortControl';
import { useSteps, useWheelSteps } from './steps';
import { prettyModelName } from './modelName';
import { useModels } from './useModels';
import { useProfiles } from '../profiles/profiles';
import { formatDayTime } from '../ui/dates';
import { usePopoverMenu } from '../ui/usePopoverMenu';

/**
 * GLOSSARY: Effort. One chip for what a thread runs: the model and a muted effort word.
 * Scrolling over it, or the up and down keys, change the effort; clicking lists the
 * profile's models, favourites first, then each provider/harness pair. GLOSSARY: Borrowing. With
 * other profiles on the hub, it also lists theirs: choosing one of their models borrows that profile's accounts.
 */
export function ModelPicker({ profileId, threadId, borrowFrom, value, onChange, disabled = false }: {
  profileId?: string;
  threadId?: string;
  /** The other profile whose accounts it uses; absent for its own. */
  borrowFrom?: string;
  value: ModelSelection;
  /** `borrowFrom` is the profile of the chosen model: null for its own, left out when only the effort changed. */
  onChange: (model: ModelSelection, borrowFrom?: string | null) => Promise<void>;
  disabled?: boolean;
}) {
  const client = useClient();
  const status = useConnectionStatus();
  const id = useId();
  const effortId = useId();
  const { profiles = [] } = useProfiles();
  // Its own profile first, then every other one whose accounts it could borrow.
  const own = profiles.find((p) => p.id === profileId);
  const lenders = own ? [own, ...profiles.filter((p) => p.id !== profileId && p.house !== null)] : [];
  const lender = borrowFrom ? profiles.find((p) => p.id === borrowFrom) : undefined;
  const using = borrowFrom ?? profileId;
  const [chosenProfile, setShownProfile] = useState<string>();
  const shownProfile = chosenProfile && lenders.some((p) => p.id === chosenProfile) ? chosenProfile : using;
  const inUse = useModels(using, threadId);
  const other = useModels(shownProfile !== using ? shownProfile : undefined, threadId);
  const { data, error: loadError, setError, update } = shownProfile !== using ? other : inUse;
  const { busy, error: actionError, run, clear } = useAction();
  const error = actionError ?? loadError;
  const [tab, setTab] = useState('favorites');

  const models = data?.models ?? [];
  const usingModels = inUse.data?.models ?? [];
  const fallbackName = value.modelId === 'default' ? `${harnessName(value.harnessId)} default` : value.modelId;
  const favorites = new Set(data?.favorites.map(modelKey));
  const groups = [...new Map(models.map((m) => [JSON.stringify([m.providerId, m.harnessId]), {
    id: JSON.stringify([m.providerId, m.harnessId]), providerId: m.providerId, provider: m.providerName, harness: m.harnessName,
  }])).values()];
  const activeTab = tab === 'favorites' || groups.some((g) => g.id === tab) ? tab : 'favorites';
  // Codex's 'default' is no longer listed; it stands for the account's default model.
  const current = value.harnessId === 'codex' && value.modelId === 'default'
    ? { harnessId: 'codex', modelId: usingModels.find((m) => m.harnessId === 'codex' && m.isDefault)?.id ?? 'default' } : value;
  const selected = usingModels.find((m) => m.harnessId === current.harnessId && m.id === current.modelId);
  // The thread's model is ticked only among the models of the profile whose accounts it uses.
  const isCurrent = (m: { harnessId: string; id: string }) => shownProfile === using && m.harnessId === current.harnessId && m.id === current.modelId;
  const shortName = short(selected?.name ?? fallbackName);
  // An older model stays listed only while it is the thread's own, so it can still be seen and left.
  const visible = models.filter((m) => !m.older || isCurrent(m)).filter((m) => activeTab === 'favorites'
    ? favorites.has(modelKey({ harnessId: m.harnessId, modelId: m.id }))
    : JSON.stringify([m.providerId, m.harnessId]) === activeTab);
  // Open on the active model's provider, where the choice is likeliest; favourites only when nothing is selected.
  const openingTab = () => selected ? JSON.stringify([selected.providerId, selected.harnessId])
    : favorites.size > 0 ? 'favorites' : groups[0]?.id ?? 'favorites';
  // One height for every tab: the longest list or the rail, whichever is taller.
  const longest = Math.max(favorites.size * 33, ...groups.map((g) => models.filter((m) => JSON.stringify([m.providerId, m.harnessId]) === g.id).length * 33));
  const switches = lenders.length > 1;
  const height = Math.min(Math.max(longest + 14, (groups.length + 1) * 40 + 12, 172) + (switches ? 37 : 0), 460);
  // A used-up allowance of the provider shown (any provider on Favourites), with the other profiles to borrow from instead.
  const shownProvider = groups.find((g) => g.id === activeTab)?.providerId;
  const usedUp = (data?.usedUp ?? []).filter((limit) => activeTab === 'favorites' || limit.providerId === shownProvider);
  const showProfile = (id: string) => { setShownProfile(id); focusItem(); };
  const { props: panelProps, trigger, popover: panel, focusItem } = usePopoverMenu({
    placement: { width: 340, side: 'above', height, gap: 8, fill: (room) => Math.min(height, room) },
    items: '[data-model-choice]',
    onToggle: (open) => { if (open) { setShownProfile(undefined); setTab(openingTab()); } },
    // Left and right step through the tabs.
    onKeyDown: (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      switchTab(event.key === 'ArrowRight' ? 1 : -1);
    },
  });
  // Buttons stay enabled while a call runs so keyboard focus never drops out of the panel.
  const choose = async (model: ModelSelection) => {
    if (busy || disabled) return;
    setError(undefined);
    // Another model keeps the effort when it accepts it, so moving from Opus to Sonnet stays at high.
    const next = models.find((m) => m.harnessId === model.harnessId && m.id === model.modelId);
    const effort = value.effort && next?.efforts.some((e) => e.id === value.effort) ? value.effort : undefined;
    await run(async () => { await onChange(effort ? { ...model, effort } : model, shownProfile === profileId ? null : shownProfile); panel.current?.hidePopover(); });
  };
  const favorite = async (model: ModelSelection, next: boolean) => {
    if (!shownProfile || busy) return;
    setError(undefined);
    await run(async () => update(await client.call('models.favorite', { profileId: shownProfile, model, favorite: next })));
  };
  const switchTab = (step: number) => {
    const tabs = ['favorites', ...groups.map((g) => g.id)];
    setTab(tabs[(tabs.indexOf(activeTab) + step + tabs.length) % tabs.length]!);
    focusItem();
  };
  const effort = selected && selected.efforts.length > 0 ? effortSteps(selected, current.effort) : undefined;
  const stepper = useSteps(effort?.steps ?? [], effort?.index ?? -1,
    (next) => onChange({ harnessId: current.harnessId, modelId: current.modelId, ...(next ? { effort: next } : {}) }), (message) => { clear(); setError(message); });
  const { props: effortProps, trigger: effortTrigger, popover: effortMenu } = usePopoverMenu({
    placement: { width: 160, side: 'above', height: 12 + (effort?.steps.length ?? 0) * 34, gap: 8 },
    onToggle: (open) => {
      if (!open && (effortMenu.current?.contains(document.activeElement) || document.activeElement === document.body)) effortTrigger.current?.focus();
    },
  });
  useWheelSteps(effortTrigger, stepper.step, !!effort);

  useEffect(() => {
    setTab('favorites');
    panel.current?.hidePopover();
  }, [profileId, panel]);

  useEffect(() => {
    if (disabled || status !== 'open') { panel.current?.hidePopover(); effortMenu.current?.hidePopover(); }
  }, [disabled, status, panel, effortMenu]);
  const shownEffort = effort?.steps[stepper.shown];
  const description = `${selected?.name ?? fallbackName}${lender ? `, on ${lender.name}’s accounts` : ''}`;

  return <span className="model-choice">
    <button type="button" ref={trigger} className="model-trigger" popoverTarget={id}
      disabled={disabled || busy || !profileId || status !== 'open'} aria-label={`Select model: ${description}`}>
      <ProviderLogo providerId={selected?.providerId ?? harnessProvider(value.harnessId)} />
      <span>{shortName}</span>
      {lender && <span className="model-borrowed" title={`Borrowing ${lender.name}’s accounts`}>{lender.name}</span>}
    </button>
    {effort && <>
      <button type="button" ref={effortTrigger} className="effort-trigger" popoverTarget={effortId}
        disabled={disabled || busy || status !== 'open'} aria-label={`Effort: ${shownEffort?.label ?? ''}`} aria-haspopup="menu"
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp') { event.preventDefault(); stepper.step(1); }
          if (event.key === 'ArrowDown') { event.preventDefault(); stepper.step(-1); }
        }}>
        <EffortWord key={modelKey(current)} steps={effort.steps} index={stepper.shown} />
      </button>
      <div id={effortId} {...effortProps} popover="auto" className="menu effort-menu" role="menu" aria-label="Effort">
        {effort.steps.map((step, i) => <button type="button" key={step.label} role="menuitemradio" className="menu-item" aria-checked={i === stepper.shown}
          onClick={() => { stepper.commit(i); effortMenu.current?.hidePopover(); }}>
          <span>{step.label}</span><span className="model-picker-check" aria-hidden>{i === stepper.shown && <Check />}</span>
        </button>)}
      </div>
    </>}
    <div id={id} {...panelProps} popover="auto" className={`model-picker${switches ? ' with-profiles' : ''}`} role="dialog" aria-label="Choose a model">
      {switches && <div className="model-picker-profiles" role="group" aria-label="Whose accounts">
        <span>Accounts</span>
        {lenders.map((p) => <button type="button" key={p.id} aria-pressed={p.id === shownProfile} onClick={() => showProfile(p.id)}>{p.name}</button>)}
      </div>}
      <nav className="model-picker-tabs" aria-label="Model groups">
        <button type="button" className="favorite" aria-pressed={activeTab === 'favorites'} aria-label="Favourites" title="Favourites" onClick={() => setTab('favorites')}>
          <Star filled />
        </button>
        {groups.map((group) => <button type="button" key={group.id} aria-pressed={activeTab === group.id} aria-label={`${group.provider} · ${group.harness}`} title={`${group.provider} · ${group.harness}`} onClick={() => setTab(group.id)}>
          <ProviderLogo providerId={group.providerId} />
        </button>)}
      </nav>
      <div className="model-picker-models" aria-busy={busy}>
        {usedUp.map((limit) => <div className="model-picker-used-up" role="status" key={`${limit.providerId}:${limit.label}`}>
          <span>{usedUpText(limit)}</span>
          {lenders.filter((p) => p.id !== shownProfile).map((p) => <button type="button" key={p.id} onClick={() => showProfile(p.id)}>
            {p.id === profileId ? `Use ${p.name}` : `Borrow from ${p.name}`}
          </button>)}
        </div>)}
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
          const isSelected = isCurrent(m);
          const isFavorite = favorites.has(key);
          return <div className={`model-picker-row${isSelected ? ' selected' : ''}${m.limited ? ' limited' : ''}`} key={key} title={m.limited ? usedUpText(m.limited) : undefined}>
            <button type="button" data-model-choice aria-pressed={isSelected} onClick={() => void choose(choice)}>
              {/* Favourites mix providers, so each row carries its provider's logo instead of the full name. */}
              <span className="model-picker-name">{activeTab === 'favorites' && <ProviderLogo providerId={m.providerId} />}<PrettyName name={m.name} /></span>
              {m.limited && <small className="model-picker-limited">{usedUpText(m.limited)}</small>}
            </button>
            {!client.browser && <button type="button" className="model-star" title={isFavorite ? 'Remove from favourites' : 'Add to favourites'}
              aria-label={`${isFavorite ? 'Remove' : 'Add'} ${m.name} ${isFavorite ? 'from' : 'to'} favourites`} aria-pressed={isFavorite}
              onClick={() => void favorite(choice, !isFavorite)}>
              <Star filled={isFavorite} />
            </button>}
            <span className="model-picker-check" aria-hidden>{isSelected && <Check />}</span>
          </div>;
        })}
      </div>
      {error && <p className="error model-picker-error" role="alert">{error}</p>}
    </div>
  </span>;
}

/** "Opus" with its version muted beside it. */
export function PrettyName({ name }: { name: string }) {
  const pretty = prettyModelName(name);
  return <span className="model-name">{pretty.name}{pretty.version && <span className="model-version">{pretty.version}</span>}</span>;
}

/** "Fable's weekly limit is used up · resets Thu 13:00" */
function usedUpText(limit: UsedUpLimit) {
  const at = limit.resetsAt && formatDayTime(limit.resetsAt);
  return `${limit.label} is used up${at ? ` · resets ${at}` : ''}`;
}

/** The provider logo already names the brand, so a name beside it drops the "Claude " prefix. */
function short(name: string): string {
  return name.replace(/^Claude\s+/, '').replace(/^./, (c) => c.toUpperCase());
}
