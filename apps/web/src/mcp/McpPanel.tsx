import { useMemo } from 'react';
import { narrowestLevel, projectKey, type LevelContext, type McpView, type ResourceLevel } from '@accio/protocol';
import { emitAppEvent } from '../app/appEvents';
import { Settings } from '../app/icons';
import { StatusPill } from '../app/Settings';
import { useProjects } from '../projects/projects';
import { useResources } from '../resources/resources';
import { useSpaces } from '../spaces/spaces';

const byName = (a: McpView, b: McpView) => a.name.localeCompare(b.name);
const target = (m: McpView) => (m.transport === 'http' ? m.url ?? '' : [m.command, ...m.args].join(' '));
const LEVEL_LABEL: Record<ResourceLevel, string> = { project: 'Project', space: 'Space', profile: 'Profile', everywhere: 'Everywhere' };

/** Where the open thread or draft is: its profile and its project, or the checkout a draft starts in. */
export type McpPanelContext = { profileId?: string; projectId?: string; checkoutId?: string };

/**
 * The MCP servers the open thread or draft gets, each with the level that turns it on (ADR 0024).
 * Only lists them; levels and sign-in change in Settings → MCP servers.
 */
export function McpPanel({ context }: { context: McpPanelContext }) {
  const { state, loadError, retry } = useResources();
  const { state: projects } = useProjects();
  const { spaces = [] } = useSpaces();
  const at = useMemo((): LevelContext => {
    const projectId = context.projectId ?? projects?.checkouts.find((c) => c.id === context.checkoutId)?.projectId;
    const project = projectId ? projects?.projects.find((p) => p.id === projectId) : undefined;
    const key = project ? projectKey(project) : undefined;
    return { profileId: context.profileId ?? project?.profileId, projectKey: key, spaceId: key ? spaces.find((s) => s.projectKeys.includes(key))?.id : undefined };
  }, [projects, spaces, context.profileId, context.projectId, context.checkoutId]);
  const all = state?.mcps ?? [];
  const mcps = useMemo(() => (state?.mcps ?? []).flatMap((m) => { const level = narrowestLevel(m.scope, at); return level ? [{ mcp: m, level }] : []; })
    .sort((a, b) => byName(a.mcp, b.mcp)), [state, at]);
  const manage = (mcpId?: string) => emitAppEvent('settings.open', { section: 'mcps', ...(mcpId ? { id: mcpId } : {}) });

  if (!state) {
    return <div className="skills-panel">
      {loadError
        ? <div className="skills-message"><p className="error" role="alert">Could not load MCP servers: {loadError}</p><button type="button" className="ghost" onClick={retry}>Retry</button></div>
        : <p className="note skills-message" role="status">Loading MCP servers…</p>}
    </div>;
  }

  const elsewhere = all.length - mcps.length;
  return (
    <div className="skills-panel">
      <section className="skills-section mcp-section" aria-labelledby="mcp-panel-title">
        <div className="skills-title-row">
          <h3 id="mcp-panel-title" className="skills-title">Servers <span className="skills-count">{mcps.length}</span></h3>
          <button type="button" className="side-icon" title="Manage MCP servers" aria-label="Manage MCP servers" onClick={() => manage()}><Settings /></button>
        </div>
        {all.length === 0 && <p className="hint skills-message">No MCP servers yet. Add one in Settings → MCP servers, or ask a thread to add one.</p>}
        {all.length > 0 && mcps.length === 0 && <p className="hint skills-message">None of your MCP servers is on for this thread.</p>}
        <ul className="skill-list">{mcps.map(({ mcp, level }) => <McpItem key={mcp.id} mcp={mcp} level={level} onOpen={manage} />)}</ul>
        {elsewhere > 0 && <p className="hint skills-message">{elsewhere === 1 ? '1 more server is' : `${elsewhere} more servers are`} on elsewhere. <button type="button" className="link" onClick={() => manage()}>Change levels</button></p>}
      </section>
    </div>
  );
}

function McpItem({ mcp, level, onOpen }: { mcp: McpView; level: ResourceLevel; onOpen: (id: string) => void }) {
  const needsSignIn = mcp.auth !== 'none' && !mcp.signedIn;
  const where = target(mcp);
  return (
    <li className="skill-item mcp-item">
      <div className="skill-line">
        <button type="button" className="skill-toggle" title={`Open ${mcp.name} in settings`} onClick={() => onOpen(mcp.id)}>
          <span className="skill-name">{mcp.name}</span>
          <span className="skill-origin" title={`On at the ${LEVEL_LABEL[level]} level`}>{LEVEL_LABEL[level]} · {mcp.transport === 'http' ? 'Remote' : 'Local'}</span>
        </button>
        {needsSignIn && <StatusPill tone="warn">Signed out</StatusPill>}
      </div>
      {where && <p className="skill-desc mcp-where" title={where}>{where}</p>}
      {mcp.status && <p className="skill-desc mcp-status">{mcp.status}</p>}
    </li>
  );
}
