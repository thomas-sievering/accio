import { SettingRow, SettingsSection } from '../app/Settings';
import { useThreads } from './threads';

/** GLOSSARY: Move on. A preference of this client, on by default. */
export function SendingSettings() {
  return <SettingsSection title="Sending"><MoveOnSetting /></SettingsSection>;
}

export function MoveOnSetting() {
  const { movesOn, setMovesOn } = useThreads();
  return (
    <SettingRow title="Move on after sending"
      description="A message that starts a turn opens the thread at the top of the inbox, or an empty page when the inbox is empty. Steering and queueing keep you in the thread.">
      <input type="checkbox" role="switch" className="switch" aria-label="Move on after sending" checked={movesOn} onChange={(e) => setMovesOn(e.target.checked)} />
    </SettingRow>
  );
}
