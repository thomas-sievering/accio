import type { TranscriptItem } from '@accio/protocol';

export type ToolItem = Extract<TranscriptItem, { kind: 'tool' }>;
export type TranscriptBlock =
  | { kind: 'item'; item: TranscriptItem }
  | { kind: 'tools'; id: string; items: ToolItem[] }
  /** A completed turn's work before its answer, folded under "Worked for …". */
  | { kind: 'work'; id: string; ms: number; failed: number; blocks: TranscriptBlock[] };

/**
 * Lays a transcript out turn by turn. A completed turn shows its prompt, its
 * work folded into one block, then its answer (the assistant messages after the
 * last other item). A running, stopped or failed turn stays fully laid out.
 * Blank assistant items render nothing, so they're dropped and never split a run.
 */
export function layoutTranscript(items: TranscriptItem[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  let start = 0;
  for (let end = 1; end <= items.length; end++) {
    if (end < items.length && items[end]!.turnId === items[start]!.turnId) continue;
    blocks.push(...layoutTurn(items.slice(start, end).filter((item) => item.kind !== 'assistant' || item.text.trim())));
    start = end;
  }
  return blocks;
}

function layoutTurn(turn: TranscriptItem[]): TranscriptBlock[] {
  const finished = turn.at(-1);
  if (finished?.kind !== 'finished') return groupTools(turn);
  const prompt = turn[0]?.kind === 'user' ? 1 : 0;
  let answer = turn.length - 1;
  while (answer > prompt && turn[answer - 1]!.kind === 'assistant') answer--;
  const work = turn.slice(prompt, answer);
  if (!work.length) return groupTools(turn);
  const failed = work.filter((item) => item.kind === 'tool' && item.status === 'error').length;
  return [
    ...groupTools(turn.slice(0, prompt)),
    { kind: 'work', id: finished.id, ms: finished.ms, failed, blocks: groupTools(work) },
    ...groupTools(turn.slice(answer, -1)),
  ];
}

/** Consecutive tool calls become one block. */
function groupTools(items: TranscriptItem[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  let run: Extract<TranscriptBlock, { kind: 'tools' }> | undefined;
  for (const item of items) {
    if (item.kind !== 'tool') {
      run = undefined;
      blocks.push({ kind: 'item', item });
    } else if (run) run.items.push(item);
    else blocks.push(run = { kind: 'tools', id: item.id, items: [item] });
  }
  return blocks;
}

type Kind = 'run' | 'read' | 'edit' | 'search' | 'fetch' | 'agent' | 'other';
const kinds: Record<string, Kind> = {
  Bash: 'run', Shell: 'run', BashOutput: 'run', KillShell: 'run',
  Read: 'read', NotebookRead: 'read',
  Edit: 'edit', MultiEdit: 'edit', Write: 'edit', NotebookEdit: 'edit',
  Glob: 'search', Grep: 'search', LS: 'search', Search: 'search', WebSearch: 'search', ToolSearch: 'search',
  WebFetch: 'fetch',
  Task: 'agent', Agent: 'agent',
};
const phrases: Record<Kind, [verb: string, one: string, many: string]> = {
  run: ['ran', 'command', 'commands'],
  read: ['read', 'file', 'files'],
  edit: ['edited', 'file', 'files'],
  search: ['ran', 'search', 'searches'],
  fetch: ['fetched', 'page', 'pages'],
  agent: ['ran', 'agent', 'agents'],
  other: ['used', 'tool', 'tools'],
};

/** "Ran 2 commands, read 1 file", in first-seen order. */
export function describeTools(items: ToolItem[]): string {
  const counts = new Map<Kind, number>();
  for (const item of items) {
    const kind = kinds[item.name] ?? 'other';
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const text = [...counts].map(([kind, n]) => {
    const [verb, one, many] = phrases[kind];
    return `${verb} ${n} ${n === 1 ? one : many}`;
  }).join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
