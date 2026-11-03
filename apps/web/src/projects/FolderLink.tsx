import { useState, type ReactNode } from 'react';

/** Only this desktop's own server can supply paths for its file manager. */
export function FolderLink({ path, children }: { path: string; children: ReactNode }) {
  const [error, setError] = useState<string>();
  if (window.accioDesktop?.serverOrigin !== window.location.origin) return <span title={path}>{children}</span>;
  const open = async () => {
    setError(undefined);
    try {
      await window.accioDesktop!.openFolder(path);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return <span>
    <button type="button" className="folder-link" title={`Open ${path} in Explorer`} onClick={() => void open()}>{children}</button>
    {error && <span className="error" role="alert"> {error}</span>}
  </span>;
}
