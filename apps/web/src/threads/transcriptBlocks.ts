import { shellCommandSummary, type TranscriptItem } from '@accio/protocol';

export type ToolItem = Extract<TranscriptItem, { kind: 'tool' }>;
export type TranscriptBlock =
  | { kind: 'item'; item: TranscriptItem }
  | { kind: 'tools'; id: string; items: ToolItem[] }
  /**
   * Work folded behind one line: while a turn runs, its calls since its last
   * message and what the harness is doing now; once it completes, all the work
   * before its answer, "Worked for …". The id is the same in both states, so
   * an opened fold stays open.
   */
  | { kind: 'work'; id: string; failed: number; blocks: TranscriptBlock[] } & (
    | { live: true; activity: string; startedAt?: string }
    | { live: false; ms: number });

/**
 * Lays a transcript out turn by turn. A completed turn shows its prompt, its
 * work folded into one block, then its answer (the assistant messages and
 * choices after the last other item). A running turn stays in order with its
 * latest calls behind a live line. A stopped or failed turn stays fully laid out. Blank assistant items render nothing, so they're dropped and never
 * split a run.
 */
export function layoutTranscript(items: TranscriptItem[], runningTurn?: string): TranscriptBlock[] {
  items = items.filter((item) => item.kind !== 'usage');
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
  if (!items.length) return [];
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
  if (!finished) return layoutRunningTurn(body, prompt);
  let answer = body.length;
  // A choice is what the turn asks of you, so it stays out of the fold with the reply.
  while (answer > prompt && (body[answer - 1]!.kind === 'assistant' || body[answer - 1]!.kind === 'choice')) answer--;
  const beforeAnswer = body.slice(prompt, answer);
  // Private entry and its usage records stay visible even when other work is folded.
  const secrets = beforeAnswer.filter((item) => item.kind === 'secret');
  const work = beforeAnswer.filter((item) => item.kind !== 'secret');
  if (finished && !work.length) return groupTools([...body.slice(0, prompt), finished, ...body.slice(prompt)]);
  const failed = work.filter((item) => item.kind === 'tool' && item.status === 'error').length;
  return [
    ...groupTools(body.slice(0, prompt)),
    { kind: 'work', id: `${turn[0]!.turnId}:work`, failed, blocks: groupTools(work), live: false, ms: finished.ms },
    ...groupTools(secrets),
    ...groupTools(body.slice(answer)),
  ];
}

/**
 * A running turn stays laid out in order, so what the harness says between
 * calls shows as it arrives. Only the calls since its last message sit behind
 * the live line at the bottom, which says what it is doing now.
 */
function layoutRunningTurn(body: TranscriptItem[], prompt: number): TranscriptBlock[] {
  let tail = body.length;
  while (tail > prompt && body[tail - 1]!.kind === 'tool') tail--;
  const calls = body.slice(tail) as ToolItem[];
  const current = calls.findLast((item) => item.status === 'running');
  const waiting = body.some((item) => item.kind === 'secret' && item.status === 'pending');
  return [
    ...groupTools(body.slice(0, tail)),
    {
      kind: 'work', id: `${body[0]!.turnId}:work`, live: true, blocks: groupTools(calls),
      failed: calls.filter((item) => item.status === 'error').length,
      activity: waiting ? 'Waiting for secret' : current ? describeLive(current) : 'Thinking',
      startedAt: prompt ? (body[0] as Extract<TranscriptItem, { kind: 'user' }>).at : undefined,
    },
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
const doing: Record<Kind, string> = { run: 'Running', read: 'Reading files', edit: 'Editing files', search: 'Searching', fetch: 'Fetching page', agent: 'Running agent', other: 'Using' };

/** A running sub-agent adds its latest activity without exposing tool inputs. */
function describeLive(item: ToolItem): string {
  return item.step ? `${describeActivity(item)} · ${describeActivity(item.step)}` : describeActivity(item);
}

/** Top-level activity keeps tool inputs behind the work fold. */
export function describeActivity(item: Pick<ToolItem, 'name' | 'summary'>): string {
  const kind = kinds[item.name] ?? 'other';
  if (kind === 'run') return `Running ${commandProgram(item.summary)}`;
  if (kind === 'other') return `${doing.other} ${toolLabel(item.name)}`;
  if (item.name === 'Write') return 'Writing files';
  return doing[kind];
}

export function toolSummary(item: Pick<ToolItem, 'name' | 'summary'>): string {
  return item.name === 'Shell' || item.name === 'Bash' ? shellCommandSummary(item.summary, true) : item.summary;
}

/** Steps that only prepare the shell; the command is named after what runs next. */
const setupPrograms = new Set(['cd', 'pushd', 'popd', 'export', 'set', 'unset', 'source', '.', 'alias', 'shopt', 'setopt', 'ulimit', 'umask',
  'set-location', 'push-location', 'pop-location', 'sl']);
/** Prefixes that run the next word as the program. */
const wrappers = new Set(['sudo', 'env', 'time', 'nohup', 'nice', 'command', 'exec', 'builtin', 'noglob', 'nocorrect']);
const shells = /^(?:sh|bash|zsh|dash|ksh|fish|powershell|pwsh|cmd)$/i;

/** Show the program doing the work, never its arguments or the surrounding shell script. */
function commandProgram(summary: string): string {
  for (const segment of shellSegments(shellCommandSummary(summary, true))) {
    const words = segment.match(/"[^"\r\n]*"|'[^'\r\n]*'|\S+/g) ?? [];
    let index = words[0] === '&' ? 1 : 0;
    while (index < words.length && (/^[A-Za-z_]\w*=/.test(words[index]!) || wrappers.has(words[index]!)
      || (index > 0 && wrappers.has(words[index - 1]!) && words[index]!.startsWith('-')))) index++;
    const program = (words[index] ?? '').replace(/^(["'])(.*)\1$/, '$2').split(/[\\/]/).at(-1)!.replace(/\.exe$/i, '');
    if (!program) continue;
    if (setupPrograms.has(program.toLowerCase())) continue;
    if (!/^[\w][\w.+-]*$/.test(program) || shells.test(program)) return 'command';
    return program;
  }
  return 'command';
}

/** Top-level commands of a script, split on ; && || | & and newlines outside quotes. */
function shellSegments(script: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: string | undefined;
  for (let index = 0; index < script.length; index++) {
    const char = script[index]!;
    if (quote) { if (char === quote) quote = undefined; current += char; continue; }
    if (char === '"' || char === "'") { quote = char; current += char; continue; }
    // A leading & is PowerShell's call operator and 2>&1 a redirection, not separators.
    if (/[;|\n]/.test(char) || (char === '&' && current.trim() && !/[<>]$/.test(current) && script[index + 1] !== '>')) {
      segments.push(current);
      current = '';
      if (script[index + 1] === char) index++;
      continue;
    }
    current += char;
  }
  return [...segments, current].map((segment) => segment.trim()).filter(Boolean);
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
