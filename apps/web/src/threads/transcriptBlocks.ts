import { shellCommandSummary, type TranscriptItem } from '@accio/protocol';

export type ToolItem = Extract<TranscriptItem, { kind: 'tool' }>;
export type TranscriptBlock =
  | { kind: 'item'; item: TranscriptItem }
  | { kind: 'tools'; id: string; items: ToolItem[] }
  /**
   * A turn's work before its answer, folded behind one line: while the turn
   * runs, what the harness is doing now; once it completes, "Worked for …".
   * The id is the same in both states, so an opened fold stays open.
   */
  | { kind: 'work'; id: string; failed: number; blocks: TranscriptBlock[] } & (
    | { live: true; activity: string; startedAt?: string }
    | { live: false; ms: number });

/**
 * Lays a transcript out turn by turn. A completed or running turn shows its
 * prompt, its work folded into one block, then its answer (the assistant
 * messages and choices after the last other item). A stopped or failed turn stays fully
 * laid out. Blank assistant items render nothing, so they're dropped and never
 * split a run.
 */
export function layoutTranscript(items: TranscriptItem[], runningTurn?: string): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  let start = 0;
  for (let end = 1; end <= items.length; end++) {
    if (end < items.length && items[end]!.turnId === items[start]!.turnId) continue;
    const turn = items.slice(start, end).filter((item) => item.kind !== 'assistant' || item.text.trim());
    blocks.push(...layoutTurn(turn, items[start]!.turnId === runningTurn));
    start = end;
  }
  return blocks;
}

function layoutTurn(items: TranscriptItem[], running: boolean): TranscriptBlock[] {
  // The duration marker may arrive before late messages (a resumed turn's media); it still closes the turn.
  const finished = items.find((item): item is Extract<TranscriptItem, { kind: 'finished' }> => item.kind === 'finished');
  const turn = finished ? [...items.filter((item) => item !== finished), finished] : items;
  // Mid-turn corrections belong in the visible conversation, in their original order.
  // The duration still heads the turn, and a running turn keeps its live line at the end.
  if (turn.some(item => item.kind === 'user' && item.steered)) {
    const rest = finished ? turn.slice(0, -1) : turn;
    const lead = rest[0]?.kind === 'user' ? 1 : 0;
    const blocks = groupTools(finished ? [...rest.slice(0, lead), finished, ...rest.slice(lead)] : rest);
    if (!running || finished) return blocks;
    const current = rest.findLast((item): item is ToolItem => item.kind === 'tool' && item.status === 'running');
    const first = rest[0];
    return [...blocks, { kind: 'work', id: `${turn[0]!.turnId}:work`, failed: 0, blocks: [], live: true,
      activity: current ? describeActivity(current) : 'Working', startedAt: first?.kind === 'user' ? first.at : undefined }];
  }
  if (!finished && !running) return groupTools(turn);
  const body = finished ? turn.slice(0, -1) : turn;
  const prompt = body[0]?.kind === 'user' ? 1 : 0;
  let answer = body.length;
  // A choice is what the turn asks of you, so it stays out of the fold with the reply.
  while (answer > prompt && (body[answer - 1]!.kind === 'assistant' || body[answer - 1]!.kind === 'choice')) answer--;
  const beforeAnswer = body.slice(prompt, answer);
  // Private entry and its usage records stay visible even when other work is folded.
  const secrets = beforeAnswer.filter((item) => item.kind === 'secret');
  const work = beforeAnswer.filter((item) => item.kind !== 'secret');
  // With nothing to fold, the duration still sits above the answer, as the fold's line would.
  if (finished && !work.length) return groupTools([...body.slice(0, prompt), finished, ...body.slice(prompt)]);
  const turnId = turn[0]!.turnId;
  const failed = work.filter((item) => item.kind === 'tool' && item.status === 'error').length;
  const current = work.findLast((item): item is ToolItem => item.kind === 'tool' && item.status === 'running');
  const state = finished
    ? { live: false as const, ms: finished.ms }
    : { live: true as const, activity: secrets.some(item => item.status === 'pending') ? 'Waiting for secret' : current ? describeActivity(current) : 'Working', startedAt: prompt ? (body[0] as Extract<TranscriptItem, { kind: 'user' }>).at : undefined };
  const workBlock: TranscriptBlock = { kind: 'work', id: `${turnId}:work`, failed, blocks: groupTools(work), ...state };
  if (running && !finished) return [...groupTools(body.slice(0, prompt)), ...groupTools(secrets), ...groupTools(body.slice(answer)), workBlock];
  return [
    ...groupTools(body.slice(0, prompt)),
    workBlock,
    ...groupTools(secrets),
    ...groupTools(body.slice(answer)),
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
const doing: Record<Kind, string> = { run: 'Running', read: 'Reading', edit: 'Editing', search: 'Searching', fetch: 'Fetching', agent: 'Running agent:', other: 'Using' };

/** "Running pnpm test", "Reading README.md", "Using linear · get_issue". */
export function describeActivity(item: ToolItem): string {
  const kind = kinds[item.name] ?? 'other';
  if (kind === 'other') return `${doing.other} ${toolLabel(item.name)}`;
  return item.summary ? `${doing[kind]} ${toolSummary(item)}` : `${doing[kind]}…`;
}

export function toolSummary(item: ToolItem): string {
  return item.name === 'Shell' || item.name === 'Bash' ? shellCommandSummary(item.summary, true) : item.summary;
}

/** MCP tools arrive as mcp__server__tool (Claude) or server/tool (Codex). */
export function toolLabel(name: string): string {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name) ?? /^([^/]+)\/(.+)$/.exec(name);
  return mcp ? `${mcp[1]} · ${mcp[2]}` : name;
}

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

/** Whether a block shows the item, directly or inside a fold. */
export function blocksHaveItem(blocks: TranscriptBlock[], itemId: string): boolean {
  return blocks.some((block) => block.kind === 'item' ? block.item.id === itemId
    : block.kind === 'tools' ? block.items.some((item) => item.id === itemId)
    : blocksHaveItem(block.blocks, itemId));
}
