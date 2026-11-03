import { useId, useState } from 'react';
import type { ThreadView, ToolDetails, TranscriptItem } from '@accio/protocol';
import { useClient } from '../app/connection';
import { More } from '../app/icons';
import { optionLetter } from './Choice';
import { useAction } from '../app/useAction';

export function ThreadActionsMenu({ thread, items }: { thread: ThreadView; items?: TranscriptItem[] }) {
  const client = useClient();
  const id = useId();
  const { busy, error, run, clear } = useAction();
  const [copied, setCopied] = useState(false);

  const copy = () => void run(async () => {
    if (!items) return;
    const entries = await Promise.all(items.map(async (item) => {
      switch (item.kind) {
        case 'user': return `## User\n\n${item.resume ? 'Resume' : item.text}`;
        case 'assistant': return `## Assistant\n\n${item.text}`;
        case 'notice': return `## Notice (${item.tone})\n\n${item.text}`;
        case 'tool': {
          const detail = item.detailRevision === undefined ? undefined : await client.call('threads.toolDetails', { threadId: thread.id, itemId: item.id });
          return [`## Tool: ${item.name} (${item.status})`, item.summary, detail ? formatDetails(detail) : item.output].filter((text) => text !== undefined && text !== '').join('\n\n');
        }
      }
    }));
    await navigator.clipboard.writeText([`# ${thread.title}`, ...entries].join('\n\n'));
    setCopied(true);
  });

  return <>
    <button className="row-action thread-actions-trigger" popoverTarget={id} aria-label="Thread actions" title="Thread actions" aria-haspopup="menu">
      <More />
    </button>
    <div id={id} className="menu thread-actions-menu" popover="auto" role="menu" aria-label="Thread actions"
      onToggle={(e) => { if (e.newState === 'open') { clear(); setCopied(false); } }}>
      <button className="menu-item" role="menuitem" disabled={!items || busy} onClick={copy} title="Copy the full thread to clipboard">
        <span className="menu-text">{busy ? 'Copying…' : 'Copy'}</span>
      </button>
      {copied && <p className="thread-copy-status" role="status">Copied to clipboard</p>}
      {error && <p className="error menu-error" role="alert">Could not copy thread: {error}</p>}
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
