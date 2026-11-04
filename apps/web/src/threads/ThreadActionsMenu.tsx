import { useId, useRef, useState } from 'react';
import type { ThreadView, ToolDetails, TranscriptItem } from '@accio/protocol';
import { useClient } from '../app/connection';
import { More } from '../app/icons';
import { useAction } from '../app/useAction';
import { ThreadMenuItems } from './ThreadMenu';

export function ThreadActionsMenu({ thread, items }: { thread: ThreadView; items?: TranscriptItem[] }) {
  const client = useClient();
  const id = useId();
  const { busy, error, run, clear } = useAction();
  const [copied, setCopied] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  // A fresh set of items each time the menu opens, so a half-done rename or delete never lingers.
  const [opened, setOpened] = useState(0);

  const copy = () => void run(async () => {
    if (!items) return;
    const entries = await Promise.all(items.map(async (item) => {
      switch (item.kind) {
        case 'user': return `## User\n\n${item.resume ? 'Resume' : item.text}`;
        case 'assistant': return `## Assistant\n\n${item.text}`;
        case 'notice': return `## Notice (${item.tone})\n\n${item.text}`;
        // Metadata only: a secret request never carries its value.
        case 'secret': return `## Secret request: ${item.label} (${item.status}${item.source ? `, ${item.source}` : ''})`;
        case 'tool': {
          const detail = item.detailRevision === undefined ? undefined : await client.call('threads.toolDetails', { threadId: thread.id, itemId: item.id });
          return [`## Tool: ${item.name} (${item.status})`, item.summary, detail ? formatDetails(detail) : item.output].filter((text) => text !== undefined && text !== '').join('\n\n');
        }
        default: return undefined;
      }
    }));
    await navigator.clipboard.writeText([`# ${thread.title}`, ...entries.filter((entry) => entry !== undefined)].join('\n\n'));
    setCopied(true);
  });

  return <>
    <button className="row-action thread-actions-trigger" popoverTarget={id} aria-label="Thread actions" title="Thread actions" aria-haspopup="menu">
      <More />
    </button>
    <div id={id} ref={menu} className="menu thread-actions-menu" popover="auto" role="menu" aria-label="Thread actions"
      onToggle={(e) => { if (e.newState === 'open') { clear(); setCopied(false); setOpened((n) => n + 1); } }}>
      <ThreadMenuItems key={opened} thread={thread} close={() => menu.current?.hidePopover()} before={<>
        <button className="menu-item" role="menuitem" disabled={!items || busy} onClick={copy}>
          <span className="menu-text">{busy ? 'Copying…' : 'Copy as Markdown'}</span>
        </button>
        {copied && <p className="thread-copy-status" role="status">Copied to clipboard</p>}
        {error && <p className="error menu-error" role="alert">Could not copy thread: {error}</p>}
        <hr />
      </>} />
    </div>
  </>;
}

function formatDetails(detail: ToolDetails): string {
  const input = typeof detail.input === 'string' ? detail.input : JSON.stringify(detail.input, null, 2);
  return [
    detail.input !== null && detail.input !== undefined ? `Input:\n${input}` : undefined,
    ...detail.parts.map((part) => part.type === 'text' ? part.text : part.type === 'media' ? `[${part.asset.name} (${part.asset.mimeType})]` : part.label),
    detail.truncated ? '[Some output was omitted from the saved result.]' : undefined,
  ].filter((text) => text !== undefined).join('\n\n');
}
