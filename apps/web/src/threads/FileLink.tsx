import type { ReactNode } from 'react';
import { useClient } from '../app/connection';
import { useAction } from '../app/useAction';

/** A current host file gets a one-file download grant, never a raw file:// navigation. */
export function FileLink({ threadId, path, children, title }: { threadId: string; path: string; children: ReactNode; title?: string }) {
  const client = useClient();
  const { busy, error, run } = useAction();
  return <span className="file-link-wrap">
    <button className="file-link" title={title ?? `Download current file: ${path}`} disabled={busy} onClick={() => void run(async () => {
      const result = await client.call('threads.fileUrl', { threadId, path });
      const link = document.createElement('a');
      link.href = client.httpUrl(result.url);
      link.download = '';
      link.click();
    })}>{children}{busy && <span className="file-link-busy"> (preparing…)</span>}</button>
    {error && <span className="file-link-error" role="alert"> {error}</span>}
  </span>;
}
