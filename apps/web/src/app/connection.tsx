import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { HubConnectionView } from '@accio/protocol';
import { RpcClient, socketUrl, takeToken, type ConnectionStatus } from './rpcClient';
import { HubSettings } from '../hub/HubSettings';

const ClientContext = createContext<RpcClient | null>(null);
const HubsContext = createContext<{ hubs: HubConnectionView[]; selectedId: string; /** The user picked this hub themselves, rather than it being the default. */ chosen: boolean; select: (id: string) => void; root: RpcClient } | null>(null);

const HUB_KEY = 'accio.hub';

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [token] = useState(takeToken);
  const [root, setRoot] = useState<RpcClient>();
  const [client, setClient] = useState<RpcClient>();
  const [hubs, setHubs] = useState<HubConnectionView[]>();
  // Remembered across restarts; without a choice, a hub you joined beats the one this machine runs for itself.
  const [selection, setSelection] = useState(() => localStorage.getItem(HUB_KEY) ?? '');
  const selectedId = hubs?.some((h) => h.id === selection) ? selection : (hubs?.find((h) => !h.local) ?? hubs?.[0])?.id ?? '';
  useEffect(() => {
    if (!token) return;
    const c = new RpcClient(socketUrl(token)); setRoot(c);
    const load = () => { if (c.status === 'open') void c.call('hubs.list', {}).then(setHubs); };
    const offStatus = c.onStatus(load); const offHubs = c.onEvent('hubs.changed', setHubs); load();
    return () => { offStatus(); offHubs(); c.close(); };
  }, [token]);
  useEffect(() => {
    if (!token || !root || hubs === undefined) return;
    if (!selectedId) { setClient(root); return; }
    const c = new RpcClient(socketUrl(token, selectedId)); setClient(c);
    return () => c.close();
  }, [token, root, selectedId, hubs === undefined]);
  if (!token) return <div className="center-screen"><h1>accio</h1><p>Open the link the server printed at startup (it ends in <code>#token=…</code>).</p></div>;
  if (!root || !client || hubs === undefined || selectedId && client.hubId !== selectedId) return null;
  const select = (id: string) => { localStorage.setItem(HUB_KEY, id); setSelection(id); };
  return <HubsContext.Provider value={{ hubs, selectedId, chosen: selection === selectedId, select, root }}>
    <ClientContext.Provider key={selectedId} value={client}>
      {hubs.length ? children : <div className="settings-page"><h1>Connect to a hub</h1><HubSettings /></div>}
    </ClientContext.Provider>
  </HubsContext.Provider>;
}

export function useClient(): RpcClient { const client = useContext(ClientContext); if (!client) throw new Error('useClient outside ConnectionProvider'); return client; }
export function useHubs() { const context = useContext(HubsContext); if (!context) throw new Error('useHubs outside ConnectionProvider'); return context; }
export function useConnectionStatus(): ConnectionStatus {
  const client = useClient(); const [status, setStatus] = useState(client.status);
  useEffect(() => { setStatus(client.status); return client.onStatus(setStatus); }, [client]);
  return status;
}
