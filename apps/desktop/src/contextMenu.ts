import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron';

export type ContextMenuActions = {
  replaceMisspelling(word: string): void;
  addToDictionary(word: string): void;
  copyText(text: string): void;
  copyImageAt(x: number, y: number): void;
};

type Params = Pick<ContextMenuParams, 'x' | 'y' | 'linkURL' | 'mediaType' | 'misspelledWord' | 'dictionarySuggestions' | 'editFlags' | 'isEditable' | 'selectionText'>;

/** The native right-click menu for a spot in the page; empty when there is nothing to offer. */
export function contextMenuTemplate(params: Params, actions: ContextMenuActions): MenuItemConstructorOptions[] {
  const groups: MenuItemConstructorOptions[][] = [];

  if (params.misspelledWord) {
    const word = params.misspelledWord;
    const suggestions: MenuItemConstructorOptions[] = params.dictionarySuggestions.slice(0, 5)
      .map((s) => ({ label: s, click: () => actions.replaceMisspelling(s) }));
    if (suggestions.length === 0) suggestions.push({ label: 'No suggestions', enabled: false });
    suggestions.push({ label: 'Add to dictionary', click: () => actions.addToDictionary(word) });
    groups.push(suggestions);
  }

  if (params.linkURL) groups.push([{ label: 'Copy Link', click: () => actions.copyText(params.linkURL) }]);
  if (params.mediaType === 'image') groups.push([{ label: 'Copy Image', click: () => actions.copyImageAt(params.x, params.y) }]);

  const { canCut, canCopy, canPaste, canSelectAll } = params.editFlags;
  if (params.isEditable) {
    groups.push([
      { role: 'cut', enabled: canCut },
      { role: 'copy', enabled: canCopy },
      { role: 'paste', enabled: canPaste },
      { role: 'selectAll', enabled: canSelectAll },
    ]);
  } else if (canCopy && params.selectionText) groups.push([{ role: 'copy' }]);

  return groups.flatMap((group, i) => (i === 0 ? group : [{ type: 'separator' as const }, ...group]));
}
