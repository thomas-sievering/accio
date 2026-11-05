import { useCallback, useEffect, useRef, useState } from 'react';
import { useClient, useConnectionStatus } from '../app/connection';
import { assetUrl } from './assetUrl';

/** Saved-media grants, including reconnect and one automatic renewal per load failure. */
export function useSavedAsset(threadId: string, assetId?: string, enabled = true) {
  const client = useClient();
  const connection = useConnectionStatus();
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [version, setVersion] = useState(0);
  const renewing = useRef(false);
  const resolvedVersion = useRef(-1);

  useEffect(() => {
    setUrl(undefined);
    setError(undefined);
    renewing.current = false;
    resolvedVersion.current = -1;
  }, [client, threadId, assetId]);

  useEffect(() => {
    if (!assetId || !enabled || connection !== 'open' || resolvedVersion.current === version) return;
    let active = true;
    setPending(true);
    // Preserve the painted source while reconnecting or renewing a grant.
    void assetUrl(client, threadId, assetId, false, version > 0).then(result => {
      if (active) { resolvedVersion.current = version; setUrl(result.url); setError(undefined); }
    }, cause => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { if (active) setPending(false); });
    return () => { active = false; };
  }, [client, threadId, assetId, enabled, connection, version]);

  const retry = useCallback(() => {
    renewing.current = false;
    setError(undefined);
    setVersion(n => n + 1);
  }, []);
  const failed = useCallback(() => {
    if (!renewing.current) { renewing.current = true; setVersion(n => n + 1); }
    else { resolvedVersion.current = -1; setError('Saved media could not be loaded. Retry or download the file.'); }
  }, []);
  const loaded = useCallback(() => { renewing.current = false; setError(undefined); }, []);
  return { url, error, pending, retry, failed, loaded };
}
