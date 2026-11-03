import { useId, useMemo, useState } from 'react';
import type { McpView } from '@accio/protocol';
import { emitAppEvent } from '../app/appEvents';
import { useClient } from '../app/connection';
import { Chevron, Close, Plus, Settings } from '../app/icons';
import { useAction } from '../app/useAction';
import { useProjects } from '../projects/projects';
import { enabledBecause, projectKey, toggled, useResources } from '../resources/resources';
import { mcpDefinition } from './mcp';
import '../skills/skills-panel.css';
import './mcp-panel.css';

const because = { global: 'Everywhere', profile: 'Profile', project: 'Project' } as const;
const byName = (a: McpView, b: McpView) => a.name.localeCompare(b.name);
const target = (m: McpView) => (m.transport === 'http' ? m.url ?? '' : [m.command, ...m.args].join(' '));

/**
 * The MCP servers the open thread (or draft) gets on its next turn, by the same
 * rule the hub uses: on everywhere, for its profile, or for its project.
 */
export function McpPanel({ profileId, projectId }: { profileId?: string; projectId?: string }) {
  const { state, loadError, retry } = useResources();
  const { state: projects } = useProjects();
  const [offOpen, setOffOpen] = useState(false);
  const offId = useId();
  const project = projectId ? projects?.projects.find((p) => p.id === projectId) : undefined;
  const key = project ? projectKey(project) : undefined;
  const mcps = useMemo(() => state?.mcps ?? [], [state]);
  const on = useMemo(() => mcps.filter((m) => enabledBecause(m.scope, profileId, key)).sort(byName), [mcps, profileId, key]);
  const off = useMemo(() => mcps.filter((m) => !enabledBecause(m.scope, profileId, key)).sort(byName), [mcps, profileId, key]);
  const manage = (mcpId?: string) => emitAppEvent('settings.open', { section: 'mcps', ...(mcpId ? { mcpId } : {}) });

  if (!state) {
    return <div className="skills-panel">
      {loadError
        ? <div className="skills-message"><p className="error" role="alert">Could not load MCP servers: {loadError}</p><button type="button" className="ghost" onClick={retry}>Retry</button></div>
        : <p className="note skills-message" role="status">Loading MCP servers…</p>}
    </div>;
  }

  const row = { profileId, projectKey: key, onOpen: manage };
  return (
    <div className="skills-panel">
      <div className="skills-head">
        <p className="note grow">{project ? <>For <b>{project.name}</b></> : projectId ? 'For this project' : 'No project'}</p>
        <button type="button" className="side-icon" title="Manage MCP servers" aria-label="Manage MCP servers" onClick={() => manage()}><Settings /></button>
      </div>

      <section className="skills-section" aria-labelledby={`${offId}-on`}>
        <div className="skills-title-row">
          <h3 id={`${offId}-on`} className="skills-title">Enabled <span className="skills-count">{on.length}</span></h3>
        </div>
        {on.length === 0 && <p className="hint skills-message">{mcps.length === 0 ? 'No MCP servers yet. Add one in Settings → MCP servers.' : 'None on for this thread.'}</p>}
        <ul className="skill-list">{on.map((m) => <McpItem key={m.id} mcp={m} {...row} />)}</ul>
      </section>

      {off.length > 0 && <section className="skills-section">
        <h3 className="skills-title">
          <button type="button" className="skills-fold" aria-expanded={offOpen} aria-controls={offId} onClick={() => setOffOpen(!offOpen)}
            title={key ? 'Not on for this thread. Add one to this project from here.' : 'Not on for this thread.'}>
            <span>Not enabled</span>
            <span className="skills-count">{off.length}</span>
            <Chevron />
          </button>
        </h3>
        {offOpen && <ul className="skill-list" id={offId}>{off.map((m) => <McpItem key={m.id} mcp={m} {...row} />)}</ul>}
      </section>}
    </div>
  );
}

function McpItem({ mcp, profileId, projectKey: key, onOpen }: { mcp: McpView; profileId?: string; projectKey?: string; onOpen: (id: string) => void }) {
  const client = useClient();
  const { busy, error, run } = useAction();
  const reason = enabledBecause(mcp.scope, profileId, key);
  const needsSignIn = mcp.auth !== 'none' && !mcp.signedIn;
  const setForProject = (enabled: boolean) => run(() => client.call('mcp.save', {
    ...mcpDefinition(mcp), scope: { ...mcp.scope, projectKeys: toggled(mcp.scope.projectKeys, key!, enabled) },
  }));
  const where = target(mcp);

  return (
    <li className="skill-item mcp-item">
      <div className="skill-line">
        <button type="button" className="skill-toggle" title={`Open ${mcp.name} in settings`} onClick={() => onOpen(mcp.id)}>
          <span className="skill-name">{mcp.name}</span>
          {reason && <span className="skill-origin">{because[reason]}</span>}
        </button>
        {needsSignIn && <button type="button" className="tag bad mcp-signin" title="Not signed in. Sign in from settings."
          aria-label={`${mcp.name}: sign in`} onClick={() => onOpen(mcp.id)}>Sign in</button>}
        {key && reason === 'project' && (
          <button type="button" className="side-icon mcp-act" disabled={busy} title="Remove from this project" aria-label={`Remove ${mcp.name} from this project`}
            onClick={() => void setForProject(false)}><Close /></button>
        )}
        {key && !reason && (
          <button type="button" className="side-icon mcp-act" disabled={busy} title="Add to this project" aria-label={`Add ${mcp.name} to this project`}
            onClick={() => void setForProject(true)}><Plus /></button>
        )}
      </div>
      {where && <p className="skill-desc mcp-where" title={where}>{where}</p>}
      {mcp.status && <p className="skill-desc mcp-status">{mcp.status}</p>}
      {error && <p className="error skills-message" role="alert">{error}</p>}
    </li>
  );
}
