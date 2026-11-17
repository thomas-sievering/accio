import { Children, Fragment, createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { ProviderId } from '@accio/protocol';
import { SETTINGS, type Section } from './settingsSections';
import { ArrowLeft, Chevron, Plus } from './icons';
import { SidebarResizer } from './Resizer';
import { HubSelector } from '../hub/HubSelector';

/** The item id of a section's page for adding one; never an item's own id. */
export const NEW = 'new';

/** Where Settings is open: a section, one of its items (`NEW` adds one), and the little state some sections keep. */
export type SettingsRoute = { section: Section; id?: string; extra?: SettingsExtra };
type SettingsExtra = {
  /** Secrets: the profile whose secrets are listed. */
  profileId?: string;
  /** Secrets: the open secret's form replaces its value. */
  replace?: boolean;
  /** Projects: Save and Cancel return to the project dashboard. */
  fromDashboard?: boolean;
  /** Accounts: the provider of a new account. */
  providerId?: ProviderId;
};

/** How a section's panels move around Settings. */
export type SettingsNav = {
  route: SettingsRoute;
  /** Opens one item of this section, or `NEW`. */
  open: (id: string, extra?: SettingsExtra) => void;
  /** Back to this section's list. */
  back: () => void;
  /** This section's list with `extra`, such as Secrets of another profile. */
  toList: (extra: SettingsExtra) => void;
  /** Any Settings route, through the open page's unsaved-edit check. */
  navigate: (route: SettingsRoute) => void;
  /** Leaves Settings. */
  close: () => void;
  openThread: (threadId: string) => void;
};

type Item = { id: string };
/** What a section loads. `items` is undefined while loading; the rest is the section's own. */
export type SectionData<T extends Item = Item> = { items?: T[]; error?: string; retry?: () => void };
type PanelProps<D> = { nav: SettingsNav; data: D };

/**
 * One Settings section, registered in `SETTINGS`. Settings draws its list, new, loading, error and
 * deleted pages, its breadcrumb and its sidebar link from this entry; the panels draw the rest.
 */
export type SectionEntry<T extends Item = Item, D extends SectionData<T> = SectionData<T>> = {
  label: string;
  icon: ReactNode;
  /** The sidebar group it is listed in; without one it opens from elsewhere (Hubs, from the hub selector). */
  group?: string;
  /** One item and many, as in "New CLI", "This CLI no longer exists." and "All CLIs". */
  noun?: string;
  plural?: string;
  /** The breadcrumb of the page that adds one, when it isn't "New <noun>". */
  newLabel?: string;
  /** Loads the section's data. Without it the section has no items to wait for. */
  useData?: (route: SettingsRoute) => D;
  /** An item's breadcrumb; its name by default. */
  name?: (item: T, route: SettingsRoute) => string | undefined;
  /** The list a page of this section goes back to; the bare section by default. */
  list?: (route: SettingsRoute) => SettingsRoute;
  /** The list shows its own loading and errors (Secrets keeps its profile picker while they load). */
  listLoads?: boolean;
  List: (props: PanelProps<D>) => ReactNode;
  New?: (props: PanelProps<D>) => ReactNode;
  Detail?: (props: PanelProps<D> & { item: T }) => ReactNode;
};

/** The sidebar's Limits link, which opens the Limits page rather than a section. */
export type LimitsLink = { label: string; icon: ReactNode; group: string; opensLimits: true };

const isSection = (entry: SectionEntry | LimitsLink): entry is SectionEntry => !('opensLimits' in entry);
const entryOf = (section: Section): SectionEntry => {
  const entry = SETTINGS[section] as SectionEntry | LimitsLink | undefined;
  return entry && isSection(entry) ? entry : SETTINGS.accounts as SectionEntry;
};
const listRoute = (route: SettingsRoute): SettingsRoute => entryOf(route.section).list?.(route) ?? { section: route.section };

/** The sidebar: table entries in order, under their groups. Read when drawn, as the table and its panels import Settings. */
const navGroups = () => Object.entries(SETTINGS as Record<string, SectionEntry | LimitsLink>).reduce<{ label: string; items: { id: string; entry: SectionEntry | LimitsLink }[] }[]>((groups, [id, entry]) => {
  if (!entry.group) return groups;
  const group = groups.find((g) => g.label === entry.group) ?? groups[groups.push({ label: entry.group, items: [] }) - 1]!;
  group.items.push({ id, entry });
  return groups;
}, []);

/**
 * Leaving a settings page with unsaved edits asks first. The page's footer registers
 * `ask` while it is dirty; it returns true when it took over (and calls `go` on Discard).
 */
const LeaveGuard = createContext<{ current?: (go: () => void) => boolean }>({});

/**
 * Settings replace the whole window while open, as in T3 Code. Back (top of the sidebar, as in Cal.com and Circle) or Escape returns to the threads.
 * Every page listed is a shared setting of the hub chosen in the selector above them. This machine's saved hubs open from that selector's menu instead.
 */
export function Settings({ route, onRoute, onClose, onOpenThread, onOpenLimits }: { route: SettingsRoute; onRoute: (r: SettingsRoute) => void; onClose: () => void; onOpenThread: (threadId: string) => void; onOpenLimits?: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const entry = entryOf(route.section);
  // Escape goes up one level and leaves Settings only from a top-level page; an open inline confirmation takes it first (useEscape).
  const leave = useRef<(go: () => void) => boolean>(undefined);
  /** Every way out of a page (section, breadcrumb, Back, Escape) goes through the page's unsaved-edit check. */
  const go = (to: () => void) => { if (!leave.current?.(to)) to(); };
  const navigate = (r: SettingsRoute) => go(() => onRoute(r));
  const leaveSettings = () => go(onClose);
  const escape = useRef<() => void>(() => undefined);
  escape.current = () => (route.id ? navigate(listRoute(route)) : leaveSettings());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Text fields use the same leave guard; native selects keep their own Escape.
      const t = e.target;
      // A sheet over Settings (project settings) takes Escape itself.
      if (document.querySelector('dialog[open], :popover-open')) return;
      if (e.key === 'Escape' && !e.defaultPrevented && !(t instanceof HTMLSelectElement)) {
        e.preventDefault();
        escape.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Panels open and leave their own pages directly: they do so only once nothing is left unsaved.
  const nav: SettingsNav = {
    route,
    open: (id, extra) => onRoute({ section: route.section, id, ...(extra ? { extra } : {}) }),
    back: () => onRoute(listRoute(route)),
    toList: (extra) => onRoute({ section: route.section, extra }),
    navigate,
    close: onClose,
    openThread: onOpenThread,
  };

  return (
    <div ref={root} className="layout">
      <aside className="sidebar">
        <header className="side-top drag">
          <button className="settings-back" title="Back to threads (Esc)" onClick={leaveSettings}>
            <ArrowLeft />
            Back
          </button>
        </header>
        <nav className="side-body">
          <HubSelector onManage={() => navigate({ section: 'hub' })} />
          {navGroups().map((g) => (
            <div key={g.label} className="settings-group">
              <div className="settings-group-label">{g.label}</div>
              {g.items.map(({ id, entry: item }) => !isSection(item) ? onOpenLimits && (
                <button key={id} className="settings-link" onClick={() => go(onOpenLimits)}>
                  {item.icon}
                  {item.label}
                </button>
              ) : (
                <button
                  key={id}
                  className={`settings-link${route.section === id ? ' active' : ''}`}
                  aria-current={route.section === id ? 'page' : undefined}
                  onClick={() => navigate({ section: id as Section })}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <SidebarResizer />
      <LeaveGuard.Provider value={leave}>
        <SectionPage key={route.section} entry={entry} nav={nav} root={root} />
      </LeaveGuard.Provider>
    </div>
  );
}

/** Whatever a section never had an entry for. */
const useNoData = (): SectionData => ({});

/**
 * The one frame of every section: its breadcrumb, then its list, the page adding one, one item's page,
 * or the same loading, error and deleted states. Keyed by section, so each section's data loads once.
 */
function SectionPage({ entry, nav, root }: { entry: SectionEntry; nav: SettingsNav; root: RefObject<HTMLDivElement | null> }) {
  const { route } = nav;
  const useData = entry.useData ?? useNoData;
  const data = useData(route);
  const { id } = route;
  const item = id && id !== NEW ? data.items?.find((i) => i.id === id) : undefined;
  const detailLabel = id === NEW ? entry.newLabel ?? `New ${entry.noun}` : item ? entry.name?.(item, route) ?? (item as { name?: string }).name : undefined;
  const loading = !!entry.useData && !data.items && (!!id || !entry.listLoads);

  const previousDetail = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const previous = previousDetail.current;
    previousDetail.current = detailLabel;
    // Wait until hidden/unmounted panes have released browser focus.
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement as HTMLElement | null;
      if (active && root.current?.contains(active) && active !== document.body && !active.matches('.crumbs') && active.getClientRects().length) return;
      const rows = [...(root.current?.querySelectorAll<HTMLElement>('.settings-page .setting-link') ?? [])];
      const row = rows.find(el => el.querySelector('b')?.textContent === previous) ?? rows[0];
      (row ?? root.current?.querySelector<HTMLElement>('.settings-page input:not(:disabled), .settings-page button:not(:disabled)') ?? root.current?.querySelector<HTMLElement>('.main-top .crumbs'))?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [route, detailLabel, root]);

  const props = { nav, data };
  const page = loading ? (data.error ? <LoadError error={data.error} retry={data.retry} /> : <p className="note" role="status">Loading {entry.plural}…</p>)
    : id === NEW && entry.New ? <entry.New key={JSON.stringify(route)} {...props} />
      : item && entry.Detail ? <entry.Detail key={`${item.id}:${JSON.stringify(route.extra ?? {})}`} {...props} item={item} />
        : id ? <><p className="note">This {entry.noun} no longer exists.</p><button type="button" className="link" onClick={nav.back}>All {entry.plural}</button></>
          : <entry.List {...props} />;

  return (
    <main className="main">
      <header className="main-top drag">
        <nav className="crumbs" tabIndex={-1}>
          <span>Settings</span>
          <span className="sep">/</span>
          {detailLabel ? (
            <>
              <button onClick={() => nav.navigate(listRoute(route))}>{entry.label}</button>
              <span className="sep">/</span>
              <b>{detailLabel}</b>
            </>
          ) : (
            <b>{entry.label}</b>
          )}
        </nav>
      </header>
      <div className="settings-scroll">
        <div className="settings-page">{page}</div>
      </div>
    </main>
  );
}

/** A section that couldn't load from the hub, with a way to try again. */
function LoadError({ error, retry }: { error: string; retry?: () => void }) {
  return <p className="error" role="alert">Could not load from the hub: {error} {retry && <button type="button" className="link" onClick={retry}>Retry</button>}</p>;
}

/** While `active` (an inline confirmation is open), Escape cancels it and goes no further: this capture listener runs before Settings' own Escape handling. */
function useEscape(active: boolean, cancel: () => void) {
  const latest = useRef(cancel);
  latest.current = cancel;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      latest.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active]);
}

/**
 * The one confirmation of an action that can't be undone, such as Delete, Remove, Disconnect or Revoke.
 * It reads the same everywhere: what happens, then Cancel, which has focus and is what Escape does, then the
 * red action last. The host shows it in place of its own button while confirming.
 */
export function ConfirmAction({ question, consequence, action, busy, error, onConfirm, onCancel }: {
  /** The group's name, as "Delete Work?". */
  question: string;
  consequence?: string;
  /** The red button, as "Delete Work". */
  action: string;
  busy?: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEscape(true, onCancel);
  return (
    <div className="confirm-action" role="group" aria-label={question}>
      {consequence && <small className="hint">{consequence}</small>}
      <button type="button" className="ghost" disabled={busy} autoFocus onClick={onCancel}>Cancel</button>
      <button type="button" className="ghost danger" disabled={busy} onClick={onConfirm}>{action}</button>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

/** A titled card of rows. `add` puts a dashed "+ label" slot under the card, so adding never reads as another row. */
export function SettingsSection({ title, add, children }: { title?: string; add?: { label: string; disabled?: boolean; onClick: () => void }; children?: ReactNode }) {
  return (
    <section className="settings-section">
      {title && <h2>{title}</h2>}
      {Children.toArray(children).length > 0 && <div className="settings-card">{children}</div>}
      {add && <button type="button" className="settings-add" disabled={add.disabled} onClick={add.onClick}><span className="menu-icon"><Plus /></span>{add.label}</button>}
    </section>
  );
}

/** The one status treatment: a dot and a word, as Connected, Signed out or Local. */
export function StatusPill({ tone, children }: { tone?: 'ok' | 'bad' | 'warn' | 'busy'; children: ReactNode }) {
  return <span className={`pill${tone ? ` ${tone === 'warn' ? 'warn-pill' : tone}` : ''}`}><span className="dot" />{children}</span>;
}

/** One setting: what it is on the left, its value or control on the right. */
export function SettingRow({ icon, title, description, children }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="setting">
      {icon && <span className="menu-icon">{icon}</span>}
      <div className="setting-text">
        <b>{title}</b>
        {description && <small>{description}</small>}
      </div>
      {children && <div className="setting-value">{children}</div>}
    </div>
  );
}

/** A setting row that opens a page: icon, title and description, then any status and a chevron. Add rows skip the chevron. */
export function SettingLink({ icon, title, description, warn, chevron = true, onClick, children }: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Shows the description as a warning. */
  warn?: boolean;
  chevron?: boolean;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button type="button" className="setting setting-link" onClick={onClick}>
      {icon && <span className="menu-icon">{icon}</span>}
      <span className="setting-text">
        <b>{title}</b>
        {description && <small className={warn ? 'warn' : undefined}>{description}</small>}
      </span>
      {children}
      {chevron && <Chevron />}
    </button>
  );
}

/**
 * The one footer of every settings detail page: Delete on the left, Cancel and Save on the right.
 * Without `saveLabel` the page has nothing to save and offers Done. Delete stays visible but disabled,
 * with `blocked` as its reason, when the thing is in use. Delete asks first (ConfirmAction).
 * With `dirty`, leaving the page another way asks "Discard changes?" here first.
 */
export function SettingsFooter({ remove, busy, onCancel, saveLabel, saveDisabled, saveForm, onSave, dirty = false }: {
  remove?: { name: string; run: () => void; blocked?: string; consequence?: string };
  busy?: boolean;
  onCancel: () => void;
  saveLabel?: string;
  saveDisabled?: boolean;
  /** The id of the form to submit when the footer sits outside it. */
  saveForm?: string;
  /** Saves without a form; otherwise the button submits one. */
  onSave?: () => void;
  /** Unsaved edits: leaving through the sidebar, breadcrumb, Back or Escape asks first. */
  dirty?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState<() => void>();
  const save = useRef<HTMLButtonElement>(null);
  const guard = useContext(LeaveGuard);
  useEffect(() => {
    if (!dirty) return;
    guard.current = (go) => { setLeaving(() => go); return true; };
    return () => { guard.current = undefined; };
  }, [dirty, guard]);
  const keepEditing = () => { setLeaving(undefined); requestAnimationFrame(() => save.current?.focus()); };
  useEscape(!!leaving, keepEditing);
  return (
    <footer className="settings-actions" role={leaving ? 'group' : undefined} aria-label={leaving ? 'Discard changes?' : undefined}>
      {remove && !leaving && (confirming ? (
        <ConfirmAction question={`Delete ${remove.name}?`} consequence={remove.consequence} action={`Delete ${remove.name}`} busy={busy} onConfirm={remove.run} onCancel={() => setConfirming(false)} />
      ) : (
        <>
          <button type="button" className="ghost danger" disabled={busy || !!remove.blocked} onClick={() => setConfirming(true)}>Delete</button>
          {remove.blocked && <small className="hint">{remove.blocked}</small>}
        </>
      ))}
      <span className="spacer" />
      {/* Keep confirmation buttons distinct from Save: reusing a clicked button as
          type=submit can submit the form after its click handler keeps editing. */}
      {leaving ? (
        <Fragment key="discard-prompt">
          <small className="hint">Discard changes?</small>
          <button type="button" className="ghost" autoFocus onClick={keepEditing}>Keep editing</button>
          <button type="button" className="ghost danger" onClick={() => { const go = leaving; setLeaving(undefined); go(); }}>Discard</button>
        </Fragment>
      ) : !confirming && (
        <Fragment key="edit-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onCancel}>{saveLabel ? 'Cancel' : 'Done'}</button>
          {saveLabel && (
            <button ref={save} type={onSave ? 'button' : 'submit'} form={onSave ? undefined : saveForm} className="ghost primary" disabled={saveDisabled} onClick={onSave}>{saveLabel}</button>
          )}
        </Fragment>
      )}
    </footer>
  );
}
