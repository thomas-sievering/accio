import { useMemo } from 'react';
import type { McpView } from '@accio/protocol';
import { emitAppEvent } from '../app/appEvents';
import { Settings } from '../app/icons';
import { StatusPill } from '../app/Settings';
import { useResources } from '../resources/resources';

const byName = (a: McpView, b: McpView) => a.name.localeCompare(b.name);
const target = (m: McpView) => (m.transport === 'http' ? m.url ?? '' : [m.command, ...m.args].join(' '));

/** The MCP servers every turn gets; the hub shares them all, so this tab only lists and links to settings. */
export function McpPanel() {
  const { state, loadError, retry } = useResources();
  const mcps = useMemo(() => [...(state?.mcps ?? [])].sort(byName), [state]);
  const manage = (mcpId?: string) => emitAppEvent('settings.open', { section: 'mcps', ...(mcpId ? { mcpId } : {}) });

  if (!state) {
    return <div className="skills-panel">
      {loadError
        ? <div className="skills-message"><p className="error" role="alert">Could not load MCP servers: {loadError}</p><button type="button" className="ghost" onClick={retry}>Retry</button></div>
        : <p className="note skills-message" role="status">Loading MCP servers…</p>}
    </div>;
  }

  return (
    <div className="skills-panel">
      <section className="skills-section mcp-section" aria-labelledby="mcp-panel-title">
        <div className="skills-title-row">
          <h3 id="mcp-panel-title" className="skills-title">Servers <span className="skills-count">{mcps.length}</span></h3>
          <button type="button" className="side-icon" title="Manage MCP servers" aria-label="Manage MCP servers" onClick={() => manage()}><Settings /></button>
        </div>
        {mcps.length === 0 && <p className="hint skills-message">No MCP servers yet. Add one in Settings → MCP servers.</p>}
        <ul className="skill-list">{mcps.map((m) => <McpItem key={m.id} mcp={m} onOpen={manage} />)}</ul>
      </section>
    </div>
  );
}

function McpItem({ mcp, onOpen }: { mcp: McpView; onOpen: (id: string) => void }) {
  const needsSignIn = mcp.auth !== 'none' && !mcp.signedIn;
  const where = target(mcp);
  return (
    <li className="skill-item mcp-item">
      <div className="skill-line">
        <button type="button" className="skill-toggle" title={`Open ${mcp.name} in settings`} onClick={() => onOpen(mcp.id)}>
          <span className="skill-name">{mcp.name}</span>
          <span className="skill-origin">{mcp.transport === 'http' ? 'Remote' : 'Local'}</span>
        </button>
        {needsSignIn && <StatusPill tone="warn">Signed out</StatusPill>}
      </div>
      {where && <p className="skill-desc mcp-where" title={where}>{where}</p>}
      {mcp.status && <p className="skill-desc mcp-status">{mcp.status}</p>}
    </li>
  );
}
