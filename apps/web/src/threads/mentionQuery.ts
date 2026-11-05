import { modelHandles, modelKey, type ModelsState, type ModelView } from '@accio/protocol';

/** GLOSSARY: Model mention. The `@query` the caret is in, if any: an @ at the start or after a space. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | undefined {
  const match = /(?:^|\s)@([a-z0-9.-]*)$/i.exec(text.slice(0, caret));
  if (!match) return undefined;
  return { start: caret - match[1]!.length - 1, query: match[1]!.toLowerCase() };
}

/** The offered models a query matches, favourites first, by handle or by any word of their name. */
export function mentionOptions(state: ModelsState | undefined, query: string): { model: ModelView; handle: string }[] {
  if (!state) return [];
  const favorites = new Set(state.favorites.map(modelKey));
  const matches = (handle: string, name: string) => !query || handle.startsWith(query)
    || [...handle.split(/[-.]/), ...name.toLowerCase().split(/[\s-]+/)].some((word) => word.startsWith(query));
  const favorite = (m: ModelView) => favorites.has(modelKey({ harnessId: m.harnessId, modelId: m.id })) ? 0 : 1;
  return modelHandles(state.models).filter((h) => matches(h.handle, h.model.name))
    .sort((a, b) => favorite(a.model) - favorite(b.model)).slice(0, 8);
}
