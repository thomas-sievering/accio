import { useEffect, useState } from 'react';
import { useHubs } from '../app/connection';
import { SettingsSection } from '../app/Settings';
import { useAction } from '../app/useAction';
import { Field } from '../resources/Field';

/** Pair a worker using the selected hub's existing one-use device grant. */
export function OnboardMachine({ onClose }: { onClose: () => void }) {
  const { hubs, selectedId, root } = useHubs();
  const hub = hubs.find((h) => h.id === selectedId);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number }>();
  const [now, setNow] = useState(Date.now);
  const [copied, setCopied] = useState<string>();
  const { busy, error, run } = useAction();
  useEffect(() => {
    if (!pairing) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pairing]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(undefined), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  if (!hub) return null;
  const localAddress = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(hub.url).hostname);
  const expired = !!pairing && now >= pairing.expiresAt;
  const prompt = pairing ? `Set up Accio on this machine and connect it to my existing hub.
Repository: https://github.com/thomas-sievering/accio
Hub name: ${hub.name}
Hub address: ${hub.url}
One-time pairing code: ${pairing.code}
Code expires: ${new Date(pairing.expiresAt).toISOString()}

Use the repository's current setup instructions. Reuse an existing installation if present. Run the desktop app for a UI and worker, or pnpm worker for a headless worker and its local browser UI. In first-run setup choose Remote hub; in an existing installation use Settings / Hubs / Add hub. Enter the hub address and pairing code above. Verify this machine appears connected in Settings / Machines. Provider accounts stay on the hub; no provider sign-in is needed. Treat the pairing code as a secret: do not commit it or print saved device credentials. If the code expires or was already used, ask me for a new one.` : '';
  const copy = (label: string, value: string) => void run(async () => {
    setCopied(undefined);
    try { await navigator.clipboard.writeText(value); setCopied(label); }
    catch { throw new Error('Couldn’t copy. Select and copy the text manually, or allow clipboard access.'); }
  });
  return <SettingsSection title="Onboard another machine">
    <div className="setting-form machine-onboard">
      <ol>
        <li>Install and open Accio on the new machine.</li>
        <li>Choose <b>Remote hub</b> in setup, or <b>Settings / Hubs / Add hub</b>.</li>
        <li>Enter this address and a pairing code. The machine will appear in this list when connected.</li>
      </ol>
      <Field label="Hub address">{(p) => <input {...p} readOnly value={hub.url} />}</Field>
      {localAddress && <p className="hint">This hub uses a local address that only works on this computer. Connect to a hub with an HTTPS address reachable from the new machine before onboarding it here.</p>}
      <div className="machine-onboard-actions">
        <button type="button" className="ghost" disabled={busy || hub.status !== 'connected'} onClick={() => void run(async () => {
          setPairing(undefined); setCopied(undefined);
          const result = await root.call('hubs.createPairingCode', { id: hub.id });
          setNow(Date.now()); setPairing(result);
        })}>{pairing ? 'Generate new code' : 'Generate pairing code'}</button>
        {pairing && <button type="button" className="ghost" disabled={busy || expired} onClick={() => copy('code', pairing.code)}>{copied === 'code' ? 'Copied' : 'Copy code'}</button>}
      </div>
      {pairing && <>
        <p role="status">{expired ? 'Code expired. Generate a new one.' : <><code>{pairing.code}</code> · expires at {new Date(pairing.expiresAt).toLocaleTimeString()}</>}</p>
        {!localAddress && <details>
          <summary>Set up with a coding agent</summary>
          <Field label="Setup prompt">{(p) => <textarea {...p} readOnly rows={8} value={expired ? 'Code expired. Generate a new one.' : prompt} />}</Field>
          <button type="button" className="ghost" disabled={busy || expired} onClick={() => copy('prompt', prompt)}>{copied === 'prompt' ? 'Copied' : 'Copy setup prompt'}</button>
        </details>}
      </>}
      <p className="hint">Codes work once, for 10 minutes. A new code replaces the previous one. Provider logins stay on the hub.</p>
      <details>
        <summary>Headless machines and client-only access</summary>
        <p className="hint">For a headless worker, run <code>pnpm worker</code> from an Accio checkout and open the printed local link to pair. Desktop includes both a client and worker. Standalone clients and running turns on another machine are not available yet.</p>
      </details>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="button" className="ghost" onClick={onClose}>Done</button>
    </div>
  </SettingsSection>;
}
