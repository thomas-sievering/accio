import { useCallback, useEffect, useState } from 'react';
import type { HubInfo } from '@accio/protocol';
import { useClient, useConnectionStatus } from '../app/connection';
import { Refresh } from '../app/icons';
import { SettingRow, SettingsSection } from '../app/Settings';

/** GLOSSARY: Hub. Where it runs and whether it answers. Accounts live under profiles. */
export function HubSettings() {
  const client = useClient();
  const status = useConnectionStatus();
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

  useEffect(() => {
    if (status === 'open') load();
  }, [status, load]);

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
        <SettingRow title="Shared settings stored in" description="Profiles and settings for each machine live here.">
          <code>{hub.settingsStore}</code>
        </SettingRow>
      </SettingsSection>
      {error && <p className="error">{error}</p>}
    </>
  );
}
