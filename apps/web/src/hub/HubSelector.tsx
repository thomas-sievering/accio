import { useHubs } from '../app/connection';
import { ChevronDown, Hub } from '../app/icons';

/** Settings-sidebar card naming the hub the Hub settings below apply to; a native select overlays it when there is more than one hub. */
export function HubSelector() {
  const { hubs, selectedId, select } = useHubs();
  const current = hubs.find((h) => h.id === selectedId);
  if (!current) return null;
  const status = current.status === 'connected' ? 'Connected' : current.status === 'connecting' ? 'Connecting' : 'Offline';
  const switchable = hubs.length > 1;
  return <div className={`hub-switcher${switchable ? ' switchable' : ''}`}>
    <span className="hub-switcher-icon"><Hub /></span>
    <span className="hub-switcher-text">
      <b>{current.name}</b>
      <small><i className={`dot ${current.status}`} />{status}{current.running ? ` · ${current.running} running` : ''}</small>
    </span>
    {switchable && <>
      <ChevronDown />
      <select aria-label="Hub" value={selectedId} onChange={(e) => select(e.target.value)}>
        {hubs.map((h) => <option key={h.id} value={h.id}>{h.name}{h.status === 'offline' ? ' · Offline' : ''}</option>)}
      </select>
    </>}
  </div>;
}
