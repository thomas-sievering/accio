import { useHubs } from '../app/connection';

export function HubSelector() {
  const { hubs, selectedId, select } = useHubs();
  return <label className="hub-selector"><span>Hub</span>
    <select aria-label="Hub" value={selectedId} onChange={(e) => select(e.target.value)}>
      {hubs.map((h) => <option key={h.id} value={h.id}>{h.name}{h.status === 'offline' ? ' · Offline' : ''}{h.running ? ` · ${h.running} running` : ''}</option>)}
    </select>
  </label>;
}
