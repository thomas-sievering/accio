import { machineHandles, modelHandles, modelKey, threadHandle, type MachineView, type ModelsState, type ModelView, type ThreadView } from '@accio/protocol';
import type { ThreadShelves } from './shelves';

/** GLOSSARY: Model mention, Machine mention, Thread mention. The `@query` the caret is in, if any: an @ at the start or after a space. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | undefined {
  const match = /(?:^|\s)@([a-z0-9.-]*)$/i.exec(text.slice(0, caret));
  if (!match) return undefined;
  return { start: caret - match[1]!.length - 1, query: match[1]!.toLowerCase() };
}

export type MentionKind = 'models' | 'machines' | 'threads';
/** Where a thread sits in the sidebar, which the menu groups threads by. */
export type ThreadGroup = 'open' | 'working' | 'snoozed' | 'settled';

export type MentionOption =
  | { handle: string; model: ModelView }
  | { handle: string; machine: MachineView }
  | { handle: string; thread: ThreadView; group: ThreadGroup }
  /** A row that opens one kind's list, shown while only @ is typed. */
  | { handle: string; kind: MentionKind; label: string };

/** How many of each group a thread list shows before anything is typed: the recent ones. */
const RECENT: Record<ThreadGroup, number> = { open: 5, working: 3, snoozed: 0, settled: 3 };
const KINDS: { kind: MentionKind; label: string }[] = [{ kind: 'models', label: 'Models' }, { kind: 'machines', label: 'Machines' }, { kind: 'threads', label: 'Threads' }];

/**
 * What the @ menu lists. With only @ typed, a row per kind that has something to offer,
 * or that kind's list straight away when it is the only one. Once you type, or inside a kind,
 * the matches: offered models, favourites first, by handle or any word of their name; online
 * machines, except one whose handle a model already has; then threads by any word of their title,
 * open before Working before Snoozed before Settled. Before you type, a kind lists the recent threads only.
 */
export function mentionOptions(state: ModelsState | undefined, query: string, machines: MachineView[] = [], threads?: ThreadShelves, browsing?: MentionKind): MentionOption[] {
  const matches = (handle: string, name: string) => !query || handle.startsWith(query)
    || [...handle.split(/[-.]/), ...name.toLowerCase().split(/[^a-z0-9]+/)].some((word) => word.startsWith(query));
  const models = state ? modelHandles(state.models) : [];
  const favorites = new Set(state?.favorites.map(modelKey));
  const favorite = (m: ModelView) => favorites.has(modelKey({ harnessId: m.harnessId, modelId: m.id })) ? 0 : 1;
  const taken = new Set(models.map((h) => h.handle));
  const lists: Record<MentionKind, () => MentionOption[]> = {
    models: () => models.filter((h) => matches(h.handle, h.model.name)).sort((a, b) => favorite(a.model) - favorite(b.model)).slice(0, 8),
    machines: () => machineHandles(machines).filter((h) => h.machine.connected && !taken.has(h.handle) && matches(h.handle, h.machine.name)).slice(0, 4),
    threads: () => (['open', 'working', 'snoozed', 'settled'] as const).flatMap((group) => {
      const shelf = (threads?.[group] ?? []).map((thread) => ({ handle: threadHandle(thread), thread, group }));
      return query ? shelf.filter((o) => matches(o.handle, o.thread.title)) : shelf.slice(0, RECENT[group]);
    }).slice(0, query ? 8 : Infinity),
  };
  if (browsing) return lists[browsing]();
  if (query) return [...lists.models(), ...lists.machines(), ...lists.threads()];
  const offered = KINDS.map((k) => ({ ...k, options: lists[k.kind]() })).filter((k) => k.options.length > 0);
  if (offered.length === 1) return offered[0]!.options;
  return offered.map(({ kind, label }) => ({ handle: `kind:${kind}`, kind, label }));
}
