import { useEffect, type ReactNode } from 'react';
import { HubSettings } from '../hub/HubSettings';
import { MachineSettings } from '../machine/MachineSettings';
import { ProfilesSettings } from '../profiles/ProfilesSettings';
import { useProfiles } from '../profiles/profiles';
import { ArrowLeft, Hub, Monitor, Users } from './icons';

/** Where Settings is open. `profileId` opens one profile ('new' to add one). */
export type SettingsRoute = { section: 'profiles'; profileId?: string } | { section: 'hub' } | { section: 'machine' };
type Section = SettingsRoute['section'];

const GROUPS: { label?: string; items: { id: Section; label: string; icon: ReactNode }[] }[] = [
  { items: [{ id: 'profiles', label: 'Profiles', icon: <Users /> }] },
  {
    label: 'Connections',
    items: [
      { id: 'hub', label: 'Hub', icon: <Hub /> },
      { id: 'machine', label: 'This machine', icon: <Monitor /> },
    ],
  },
];
const LABEL = Object.fromEntries(GROUPS.flatMap((g) => g.items.map((i) => [i.id, i.label]))) as Record<Section, string>;

/** Settings replace the whole window while open, as in T3 Code. Back (top of the sidebar, as in Cal.com and Circle) or Escape returns to the threads. */
export function Settings({ route, onRoute, onClose }: { route: SettingsRoute; onRoute: (r: SettingsRoute) => void; onClose: () => void }) {
  const { profiles } = useProfiles();
  const profileId = route.section === 'profiles' ? route.profileId : undefined;
  const profileLabel = profileId === 'new' ? 'New profile' : profiles?.find((p) => p.id === profileId)?.name;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape inside a field only leaves the field.
      const t = e.target;
      if (e.key === 'Escape' && !(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="layout">
      <aside className="sidebar">
        <header className="side-top drag">
          <button className="settings-back" title="Back to threads (Esc)" onClick={onClose}>
            <ArrowLeft />
            Back
          </button>
        </header>
        <nav className="side-body">
          {GROUPS.map((g, n) => (
            <div key={n} className="settings-group">
              {g.label && <div className="settings-group-label">{g.label}</div>}
              {g.items.map((i) => (
                <button
                  key={i.id}
                  className={`settings-link${route.section === i.id ? ' active' : ''}`}
                  aria-current={route.section === i.id ? 'page' : undefined}
                  onClick={() => onRoute({ section: i.id })}
                >
                  {i.icon}
                  {i.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <main className="main">
        <header className="main-top drag">
          <nav className="crumbs">
            <span>Settings</span>
            <span className="sep">/</span>
            {profileLabel ? (
              <>
                <button onClick={() => onRoute({ section: 'profiles' })}>{LABEL[route.section]}</button>
                <span className="sep">/</span>
                <b>{profileLabel}</b>
              </>
            ) : (
              <b>{LABEL[route.section]}</b>
            )}
          </nav>
        </header>
        <div className="settings-scroll">
          <div className="settings-page">
            {route.section === 'profiles' && (
              <ProfilesSettings
                profileId={profileId}
                onOpen={(id) => onRoute({ section: 'profiles', profileId: id })}
                onBack={() => onRoute({ section: 'profiles' })}
              />
            )}
            {route.section === 'hub' && <HubSettings onOpenProfile={(id) => onRoute({ section: 'profiles', profileId: id })} />}
            {route.section === 'machine' && <MachineSettings />}
          </div>
        </div>
      </main>
    </div>
  );
}

/** A titled group of settings, drawn as one card. */
export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h2>{title}</h2>
      <div className="settings-card">{children}</div>
    </section>
  );
}

/** One setting: what it is on the left, its value or control on the right. */
export function SettingRow({ title, description, children }: { title: ReactNode; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="setting">
      <div className="setting-text">
        <b>{title}</b>
        {description && <small>{description}</small>}
      </div>
      {children && <div className="setting-value">{children}</div>}
    </div>
  );
}
