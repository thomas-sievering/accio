import { useEffect, useState, type FormEvent } from 'react';
import type { McpDefinition, McpView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { Plug, Plus } from '../app/icons';
import { ConfirmDelete, SettingLink, SettingRow, SettingsSection } from '../app/Settings';
import { useAction } from '../app/useAction';
import { LoadError, slugId, useDraft, useResources } from '../resources/resources';
import { Field } from '../resources/Field';
import { mcpDefinition } from './mcp';

const blank = (): McpDefinition => ({ id: '', name: '', transport: 'http', url: '', command: '', args: [], auth: 'none', oauthClientId: undefined });
const authLabel = { none: 'No sign-in', bearer: 'Bearer token', oauth: 'OAuth sign-in' } as const;

/** MCP servers threads can use. Remote servers go through the hub, which keeps their credentials. */
export function McpSettings({ mcpId, onOpen, onBack }: { mcpId?: string; onOpen: (id: string) => void; onBack: () => void }) {
  const { state, loadError, retry } = useResources();
  if (!state) return loadError ? <LoadError error={loadError} retry={retry} /> : <p className="note" role="status">Loading MCP servers…</p>;
  if (mcpId === 'new') return <McpForm taken={state.mcps.map((m) => m.id)} onSaved={(m) => onOpen(m.id)} onDone={onBack} />;
  const mcp = state.mcps.find((m) => m.id === mcpId);
  if (mcpId && !mcp) return <><p className="note">This MCP server was deleted.</p><button className="link" onClick={onBack}>All MCP servers</button></>;
  if (mcp) return <McpForm key={mcp.id} mcp={mcp} taken={[]} onSaved={() => {}} onDone={onBack} />;
  return (
    <>
      <p className="note">Remote (HTTP) servers are reached through the hub, which holds their tokens; machines never see them. Local (stdio) servers run as a command on the machine running the thread.</p>
      <SettingsSection title="MCP servers">
        {state.mcps.length === 0 && <SettingRow title="No MCP servers yet" />}
        {[...state.mcps].sort((a, b) => a.name.localeCompare(b.name)).map((m) => (
          <SettingLink key={m.id} icon={<Plug />} title={m.name} description={m.transport === 'http' ? m.url : [m.command, ...m.args].join(' ')} onClick={() => onOpen(m.id)}>
            <McpPill mcp={m} />
          </SettingLink>
        ))}
        <SettingLink icon={<Plus />} title="Add MCP server" description="Connect a remote service or run a local MCP server." chevron={false} onClick={() => onOpen('new')} />
      </SettingsSection>
    </>
  );
}

function McpPill({ mcp }: { mcp: McpView }) {
  if (mcp.transport === 'stdio') return <span className="pill"><span className="dot" />Local</span>;
  if (mcp.auth === 'none') return <span className="pill ok"><span className="dot" />No sign-in</span>;
  return mcp.signedIn ? <span className="pill ok"><span className="dot" />Signed in</span> : <span className="pill warn-pill"><span className="dot" />Signed out</span>;
}

function urlProblem(url?: string) {
  if (!url?.trim()) return 'Enter the server’s URL.';
  try {
    const u = new URL(url.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? undefined : 'Use an http:// or https:// URL.';
  } catch {
    return 'Enter a full URL, such as https://mcp.example.com/mcp.';
  }
}

function McpForm({ mcp, taken, onSaved, onDone }: { mcp?: McpView; taken: string[]; onSaved: (m: McpView) => void; onDone: () => void }) {
  const client = useClient();
  const { value, dirty, set, reset } = useDraft<McpDefinition>(mcp ? mcpDefinition(mcp) : blank());
  const [argsText, setArgsText] = useState<string>();
  const [touched, setTouched] = useState(false);
  const { busy, error, run } = useAction();
  const http = value.transport === 'http';
  const args = (argsText ?? value.args.join('\n')).split(/\r?\n/).map((a) => a.trim()).filter(Boolean);
  const changed = dirty || (argsText !== undefined && JSON.stringify(args) !== JSON.stringify(mcp?.args ?? []));
  const problems = {
    name: !value.name.trim() ? 'Give the server a name.' : undefined,
    url: http ? urlProblem(value.url) : undefined,
    command: !http && !value.command?.trim() ? 'Enter the command that starts the server, such as npx.' : undefined,
  };
  const invalid = Object.values(problems).some(Boolean);
  const show = (k: keyof typeof problems) => (touched || !!(value[k] as string | undefined)) && problems[k];
  const signsOut = !!mcp?.signedIn && (value.url !== mcp.url || value.auth !== mcp.auth || (value.oauthClientId || undefined) !== (mcp.oauthClientId || undefined));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (invalid) return;
    const def: McpDefinition = http
      ? { id: mcp?.id ?? slugId(value.name, taken), name: value.name.trim(), transport: 'http', url: value.url!.trim(), args: [], auth: value.auth, oauthClientId: value.auth === 'oauth' ? value.oauthClientId?.trim() || undefined : undefined }
      : { id: mcp?.id ?? slugId(value.name, taken), name: value.name.trim(), transport: 'stdio', command: value.command!.trim(), args, auth: 'none' };
    const saved = await run(() => client.call('mcp.save', def));
    if (saved) { reset(); setArgsText(undefined); setTouched(false); onSaved(saved); }
  };
  const remove = async () => {
    if (mcp && (await run(async () => (await client.call('mcp.delete', { id: mcp.id }), true)))) onDone();
  };

  return (
    <div className="settings-profile-form">
      <form className="settings-profile-form" onSubmit={submit} noValidate id="mcp-form">
        <SettingsSection title={mcp ? mcp.name : 'New MCP server'}>
          <div className="setting-form">
            <Field label="Name" error={show('name')}>
              {(p) => <input {...p} value={value.name} onChange={(e) => set('name', e.target.value)} placeholder="Linear (work)" maxLength={120} required autoFocus={!mcp} />}
            </Field>
            <fieldset className="segmented" aria-label="Transport">
              <legend>Transport</legend>
              <label className={http ? 'on' : ''}>
                <input type="radio" name="transport" checked={http} onChange={() => set('transport', 'http')} />
                <span><b>Remote (HTTP)</b><small>Through the hub, which holds the credentials</small></span>
              </label>
              <label className={!http ? 'on' : ''}>
                <input type="radio" name="transport" checked={!http} onChange={() => { set('transport', 'stdio'); set('auth', 'none'); }} />
                <span><b>Local command (stdio)</b><small>Runs on the machine running the thread</small></span>
              </label>
            </fieldset>
            {http ? (
              <>
                <Field label="Server URL" error={show('url')}>
                  {(p) => <input {...p} type="url" value={value.url ?? ''} onChange={(e) => set('url', e.target.value)} placeholder="https://mcp.example.com/mcp" spellCheck={false} required />}
                </Field>
                <label className="field">
                  <span>Authentication</span>
                  <select value={value.auth} onChange={(e) => set('auth', e.target.value as McpDefinition['auth'])}>
                    <option value="none">{authLabel.none}</option>
                    <option value="bearer">{authLabel.bearer}</option>
                    <option value="oauth">{authLabel.oauth}</option>
                  </select>
                </label>
                {value.auth === 'oauth' && (
                  <label className="field">
                    <span>OAuth client ID (optional)</span>
                    <input value={value.oauthClientId ?? ''} onChange={(e) => set('oauthClientId', e.target.value || undefined)} placeholder="Registered automatically when the service allows it" spellCheck={false} />
                  </label>
                )}
                {signsOut && <small className="warn" role="status">Saving a new URL, authentication or client ID signs this server out.</small>}
              </>
            ) : (
              <>
                <Field label="Command" error={show('command')}>
                  {(p) => <input {...p} value={value.command ?? ''} onChange={(e) => set('command', e.target.value)} placeholder="npx" spellCheck={false} required />}
                </Field>
                <label className="field">
                  <span>Arguments, one per line</span>
                  <textarea rows={3} value={argsText ?? value.args.join('\n')} onChange={(e) => setArgsText(e.target.value)} placeholder={'-y\n@example/mcp-server'} spellCheck={false} />
                </label>
                <small className="hint">The server handles its own sign-in, if any. For credentials kept on the hub, use a remote server.</small>
              </>
            )}
          </div>
        </SettingsSection>
        <p className="note">This MCP server is available to every profile and project.</p>
      </form>
      {mcp && mcp.transport === 'http' && mcp.auth !== 'none' && <McpCredentials key={`${mcp.id}:${mcp.auth}:${mcp.url}`} mcp={mcp} />}
      {error && <p className="error" role="alert">{error}</p>}
      <footer className="settings-actions">
        {mcp && <ConfirmDelete busy={busy} confirm={`Delete ${mcp.name} and its sign-in`} onDelete={remove} />}
        <span className="spacer" />
        {changed && mcp && <button type="button" className="ghost" disabled={busy} onClick={() => { reset(); setArgsText(undefined); setTouched(false); }}>Discard changes</button>}
        <button type="button" className="ghost" onClick={onDone}>{mcp ? 'Done' : 'Cancel'}</button>
        <button type="submit" form="mcp-form" className="ghost primary" disabled={busy || (!!mcp && !changed) || (touched && invalid)}>
          {busy ? 'Saving…' : mcp ? 'Save' : 'Add MCP server'}
        </button>
      </footer>
    </div>
  );
}

const SIGN_IN_TIMEOUT = 10 * 60_000;

/** The hub's credential for a remote server. Saved tokens are never shown again. */
function McpCredentials({ mcp }: { mcp: McpView }) {
  const client = useClient();
  const { refresh } = useResources();
  const { busy, error, run } = useAction();
  const [token, setToken] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [pending, setPending] = useState<{ url: string; started: number }>();
  const [callback, setCallback] = useState('');
  const [note, setNote] = useState<string>();

  // The hub stores the OAuth callback without announcing it, so ask until it lands.
  useEffect(() => {
    if (!pending) return;
    let active = true;
    const timer = setInterval(() => {
      if (Date.now() - pending.started > SIGN_IN_TIMEOUT) {
        setPending(undefined);
        setNote('Sign-in expired. Start again.');
        return;
      }
      refresh().then((s) => { if (active && s.mcps.find((m) => m.id === mcp.id)?.signedIn) setPending(undefined); }, () => {});
    }, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [pending, refresh, mcp.id]);
  useEffect(() => { if (pending && mcp.signedIn) setPending(undefined); }, [pending, mcp.signedIn]);

  const signIn = () => run(async () => {
    setNote(undefined);
    if (mcp.signedIn) await client.call('mcp.signOut', { id: mcp.id });
    const { url } = await client.call('mcp.beginSignIn', { id: mcp.id }).catch((err: Error) => {
      throw new Error(`Couldn’t start sign-in with ${mcp.url}: ${err.message}`);
    });
    setCallback('');
    setPending({ url, started: Date.now() });
    window.open(url, '_blank', 'noopener');
  });
  const complete = async (e: FormEvent) => {
    e.preventDefault();
    const done = await run(async () => (await client.call('mcp.completeSignIn', { id: mcp.id, callbackUrl: callback.trim() }), true));
    if (done) { setPending(undefined); setCallback(''); }
  };
  const saveToken = async (e: FormEvent) => {
    e.preventDefault();
    const done = await run(async () => (await client.call('mcp.setToken', { id: mcp.id, token: token.trim() }), true));
    if (done) { setToken(''); setReplacing(false); }
  };
  const signOut = () => run(() => client.call('mcp.signOut', { id: mcp.id }));

  return (
    <SettingsSection title={mcp.auth === 'bearer' ? 'Token' : 'Sign-in'}>
      <div className="setting-form">
        {mcp.auth === 'bearer' ? (
          mcp.signedIn && !replacing ? (
            <div className="signin-status">
              <span className="dot ok" /><span className="grow">A token is saved on the hub. It’s never shown again.</span>
              <button type="button" className="link" disabled={busy} onClick={() => setReplacing(true)}>Replace token</button>
              <button type="button" className="link" disabled={busy} onClick={signOut}>Remove token</button>
            </div>
          ) : (
            <form className="field" onSubmit={saveToken}>
              <span>Bearer token</span>
              <span className="row-input">
                <input type="password" autoComplete="off" spellCheck={false} aria-label="Bearer token" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste the token" />
                <button type="submit" className="ghost primary" disabled={busy || !token.trim()}>Save token</button>
                {replacing && <button type="button" className="ghost" onClick={() => { setReplacing(false); setToken(''); }}>Cancel</button>}
              </span>
              <small className="hint">Kept on the hub only and sent as <code>Authorization: Bearer …</code> to {mcp.url}.</small>
            </form>
          )
        ) : pending ? (
          <>
            <p className="note" role="status">Waiting for sign-in. Finish signing in on the page that opened; this updates by itself.</p>
            <span className="signin-links">
              <a className="link" href={pending.url} target="_blank" rel="noopener noreferrer">Open the sign-in page again</a>
              <button type="button" className="link" disabled={busy} onClick={() => run(async () => { await client.call('mcp.signOut', { id: mcp.id }); setPending(undefined); })}>Cancel</button>
            </span>
            <form className="field" onSubmit={complete}>
              <span>Didn’t come back? Paste the address the browser ended on</span>
              <span className="row-input">
                <input type="url" spellCheck={false} aria-label="Callback address" value={callback} onChange={(e) => setCallback(e.target.value)} placeholder="http://127.0.0.1:…/mcp/oauth/callback?code=…" />
                <button type="submit" className="ghost primary" disabled={busy || !callback.trim()}>Complete sign-in</button>
              </span>
              <small className="hint">Use this when the browser can’t reach the hub, for example on another computer.</small>
            </form>
          </>
        ) : mcp.signedIn ? (
          <div className="signin-status">
            <span className="dot ok" /><span className="grow">Signed in. The hub keeps the credentials and refreshes them.</span>
            <button type="button" className="link" disabled={busy} onClick={signIn}>Sign in again</button>
            <button type="button" className="link" disabled={busy} onClick={signOut}>Sign out</button>
          </div>
        ) : (
          <div className="signin-status">
            <span className="dot" /><span className="grow">Signed out. Threads can’t use {mcp.name} until you sign in.</span>
            <button type="button" className="ghost primary" disabled={busy} onClick={signIn}>Sign in</button>
          </div>
        )}
        {note && <p className="hint" role="status">{note}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </SettingsSection>
  );
}
