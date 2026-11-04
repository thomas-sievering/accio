import type { BuiltinToolView, HarnessView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { SettingRow, SettingsSection } from '../app/Settings';
import { useAction } from '../app/useAction';

/** How many tool names the model sees, out of all the harness has. */
export function toolCount(tools: BuiltinToolView[]) {
  const all = tools.reduce((n, t) => n + t.tools.length, 0);
  const on = tools.reduce((n, t) => n + (t.on ? t.tools.length : 0), 0);
  return `${on} of ${all} on`;
}

/** GLOSSARY: Built-in tools. One switch per row, shared by the whole hub; changes apply from each thread's next turn. */
export function BuiltinToolsSettings({ harness, onChanged }: { harness: HarnessView; onChanged: (list: HarnessView[]) => void }) {
  const client = useClient();
  const { busy, error, run } = useAction();
  const changed = harness.tools.some((t) => t.on !== t.defaultOn && !t.required);
  const set = (toolId: string, on: boolean) => run(async () => onChanged(await client.call('harnesses.setTool', { harnessId: harness.id, toolId, on })));
  const reset = () => run(async () => onChanged(await client.call('harnesses.resetTools', { harnessId: harness.id })));
  return (
    <>
      <SettingsSection title={`${harness.name} · ${toolCount(harness.tools)}`}>
        {harness.tools.map((t) => (
          <SettingRow key={t.id} title={<span title={t.description}>{t.name}</span>} description={<code>{t.tools.join(' · ')}</code>}>
            {t.required ? <span className="tool-required">Required</span> : (
              <input type="checkbox" role="switch" className="switch" aria-label={t.name} title={t.description}
                checked={t.on} disabled={busy} onChange={(e) => set(t.id, e.target.checked)} />
            )}
          </SettingRow>
        ))}
      </SettingsSection>
      {error && <p className="error" role="alert">{error}</p>}
      {changed && (
        <footer className="settings-actions">
          <span className="spacer" />
          <button type="button" className="ghost" disabled={busy} onClick={reset}>Reset to defaults</button>
        </footer>
      )}
    </>
  );
}
