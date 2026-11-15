import type { ReactNode } from 'react';
import { useAction } from '../app/useAction';

/** Only this desktop's own server can supply paths for its file manager. */
export function FolderLink({ path, children, className }: { path: string; children: ReactNode; className?: string }) {
  const { error, run } = useAction();
  if (window.accioDesktop?.serverOrigin !== window.location.origin) return <span className={className} title={path}>{children}</span>;
  const open = () => run(() => window.accioDesktop!.openFolder(path));
  return <span className={className}>
    <button type="button" className="folder-link" title={`Open ${path} in Explorer`} onClick={() => void open()}>{children}</button>
    {error && <span className="error" role="alert"> {error}</span>}
  </span>;
}
