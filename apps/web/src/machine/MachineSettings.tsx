import { useEffect, useState } from 'react';
import type { MachineInfo } from '@accio/protocol';
import { useClient, useConnectionStatus } from '../app/connection';
import { SettingRow, SettingsSection } from '../app/Settings';

/** GLOSSARY: Machine. The one this client is talking to. */
export function MachineSettings() {
  const client = useClient();
  const status = useConnectionStatus();
  const [machine, setMachine] = useState<MachineInfo>();

  useEffect(() => {
    if (status === 'open') client.call('machine.get', {}).then(setMachine, () => {});
  }, [client, status]);

  return (
    <SettingsSection title="This machine">
      <SettingRow title="Name" description="The computer this window is talking to.">
        <code>{machine?.name ?? '…'}</code>
      </SettingRow>
      <SettingRow title="Platform">
        <code>{machine?.platform ?? '…'}</code>
      </SettingRow>
      <SettingRow title="accio version">
        <code>{machine?.version ?? '…'}</code>
      </SettingRow>
    </SettingsSection>
  );
}
