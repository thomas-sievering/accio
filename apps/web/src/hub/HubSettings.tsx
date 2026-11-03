import { useCallback, useEffect, useState } from 'react';
import type { HubInfo } from '@accio/protocol';
import { useClient, useConnectionStatus } from '../app/connection';
import { Refresh } from '../app/icons';
import { SettingRow, SettingsSection } from '../app/Settings';
import { ProfileTile, useProfiles } from '../profiles/profiles';

/** GLOSSARY: Hub. Read-only for now: where it runs, whether it answers, and the accounts it holds. */
export function HubSettings({ onOpenProfile }: { onOpenProfile: (profileId: string) => void }) {
  const client = useClient();
  const status = useConnectionStatus();
  const { profiles } = useProfiles();
  const [hub, setHub] = useState<HubInfo>();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(() => {
    setChecking(true);
    client
      .call('hub.get', {})
      .then(
        (h) => {
          setHub(h);
          setError(undefined);
        },
        (err: Error) => setError(err.message),
      )
      .finally(() => setChecking(false));
  }, [client]);

  // Reload when a profile or its sign-in changes, so the accounts stay current.
  useEffect(() => {
    if (status === 'open') load();
  }, [status, load, profiles]);

  if (!hub) return error ? <p className="error">{error}</p> : null;

  return (
    <>
      <SettingsSection title="Hub">
        <SettingRow
          title="Status"
          description="For now the hub runs inside this machine’s server. Later it runs on its own, always on, and every machine connects to it."
        >
          <span className={`pill ${hub.reachable ? 'ok' : 'bad'}`}>
            <span className="dot" />
            {hub.reachable ? 'Answering' : 'Not answering'}
          </span>
          <button className="side-icon" title="Check again" aria-label="Check again" onClick={load} disabled={checking}>
            <Refresh />
          </button>
        </SettingRow>
        <SettingRow title="Address" description="Threads reach their profile’s accounts here. accio writes it into each profile’s Claude config folder.">
          <code>{hub.url}</code>
        </SettingRow>
        <SettingRow title="Accounts stored in" description="Readable by your user only. The tokens never leave the hub.">
          <code>{hub.store}</code>
        </SettingRow>
      </SettingsSection>
      <SettingsSection title="Accounts">
        {hub.profiles.length === 0 && <SettingRow title="No profiles yet" description="Add a profile, then sign it in with Claude." />}
        {hub.profiles.map((p) => (
          <SettingRow
            key={p.profileId}
            title={
              <span className="with-tile">
                <ProfileTile profile={profiles?.find((x) => x.id === p.profileId)} size="xs" />
                {p.name}
              </span>
            }
            description={
              p.account
                ? `Claude · ${p.account.email ?? 'signed in'}${p.account.organization ? ` · ${p.account.organization}` : ''}`
                : 'No account yet, so its threads cannot run.'
            }
          >
            {p.account ? (
              <span className="pill ok">
                <span className="dot" />
                Signed in
              </span>
            ) : (
              <button className="ghost" onClick={() => onOpenProfile(p.profileId)}>
                Sign in…
              </button>
            )}
          </SettingRow>
        ))}
      </SettingsSection>
      {error && <p className="error">{error}</p>}
    </>
  );
}
