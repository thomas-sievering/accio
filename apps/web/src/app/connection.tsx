import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { RpcClient, socketUrl, takeToken, type ConnectionStatus } from './rpcClient';

const ClientContext = createContext<RpcClient | null>(null);

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [token] = useState(takeToken);
  const [client, setClient] = useState<RpcClient | null>(null);

  useEffect(() => {
    if (!token) return;
    const c = new RpcClient(socketUrl(token));
    setClient(c);
    return () => c.close();
  }, [token]);

  if (!token) {
    return (
      <div className="center-screen">
        <h1>accio</h1>
        <p>
          Open the link the server printed at startup (it ends in <code>#token=…</code>).
        </p>
      </div>
    );
  }
  if (!client) return null;
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>;
}

export function useClient(): RpcClient {
  const c = useContext(ClientContext);
  if (!c) throw new Error('useClient outside ConnectionProvider');
  return c;
}

export function useConnectionStatus(): ConnectionStatus {
  const client = useClient();
  const [status, setStatus] = useState(client.status);
  useEffect(() => {
    setStatus(client.status);
    return client.onStatus(setStatus);
  }, [client]);
  return status;
}
