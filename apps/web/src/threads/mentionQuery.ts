import { machineHandles, modelHandles, modelKey, type MachineView, type ModelsState, type ModelView } from '@accio/protocol';

/** GLOSSARY: Model mention, Machine mention. The `@query` the caret is in, if any: an @ at the start or after a space. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | undefined {
  const match = /(?:^|\s)@([a-z0-9.-]*)$/i.exec(text.slice(0, caret));
  if (!match) return undefined;
  return { start: caret - match[1]!.length - 1, query: match[1]!.toLowerCase() };
}

export type MentionOption = { handle: string; model: ModelView } | { handle: string; machine: MachineView };

/**
 * The offered models a query matches, favourites first, by handle or by any word of their name;
 * then the online machines it matches, except one whose handle a model already has.
 */
export function mentionOptions(state: ModelsState | undefined, query: string, machines: MachineView[] = []): MentionOption[] {
  const matches = (handle: string, name: string) => !query || handle.startsWith(query)
    || [...handle.split(/[-.]/), ...name.toLowerCase().split(/[\s-]+/)].some((word) => word.startsWith(query));
  const models = state ? modelHandles(state.models) : [];
  const favorites = new Set(state?.favorites.map(modelKey));
  const favorite = (m: ModelView) => favorites.has(modelKey({ harnessId: m.harnessId, modelId: m.id })) ? 0 : 1;
  const taken = new Set(models.map((h) => h.handle));
  return [
    ...models.filter((h) => matches(h.handle, h.model.name)).sort((a, b) => favorite(a.model) - favorite(b.model)).slice(0, 8),
    ...machineHandles(machines).filter((h) => h.machine.connected && !taken.has(h.handle) && matches(h.handle, h.machine.name)).slice(0, 4),
  ];
}
