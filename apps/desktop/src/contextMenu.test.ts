import { expect, it, vi } from 'vitest';
import { contextMenuTemplate, type ContextMenuActions } from './contextMenu.js';

const flags = { canUndo: false, canRedo: false, canCut: false, canCopy: false, canPaste: false, canDelete: false, canSelectAll: false, canEditRichly: false };
const base = { x: 10, y: 20, linkURL: '', mediaType: 'none' as const, misspelledWord: '', dictionarySuggestions: [], editFlags: flags, isEditable: false, selectionText: '' };
const actions = (): ContextMenuActions => ({ replaceMisspelling: vi.fn(), addToDictionary: vi.fn(), copyText: vi.fn(), copyImageAt: vi.fn() });
const names = (template: ReturnType<typeof contextMenuTemplate>) => template.map((i) => i.label ?? i.role ?? i.type);

it('offers nothing on plain page background', () => {
  expect(contextMenuTemplate(base, actions())).toEqual([]);
});

it('offers Copy for selected page text', () => {
  const t = contextMenuTemplate({ ...base, selectionText: 'hi', editFlags: { ...flags, canCopy: true, canSelectAll: true } }, actions());
  expect(names(t)).toEqual(['copy']);
});

it('offers the edit commands in the composer, disabled where not allowed', () => {
  const t = contextMenuTemplate({ ...base, isEditable: true, editFlags: { ...flags, canPaste: true, canSelectAll: true } }, actions());
  expect(t.map((i) => [i.role, i.enabled])).toEqual([['cut', false], ['copy', false], ['paste', true], ['selectAll', true]]);
});

it('replaces a misspelled word or adds it to the dictionary', () => {
  const a = actions();
  const t = contextMenuTemplate({ ...base, isEditable: true, misspelledWord: 'teh', dictionarySuggestions: ['the', 'ten'] }, a);
  expect(names(t)).toEqual(['the', 'ten', 'Add to dictionary', 'separator', 'cut', 'copy', 'paste', 'selectAll']);
  t[0]!.click!({} as never, undefined, {} as never);
  t[2]!.click!({} as never, undefined, {} as never);
  expect(a.replaceMisspelling).toHaveBeenCalledWith('the');
  expect(a.addToDictionary).toHaveBeenCalledWith('teh');
});

it('copies a link address and an image', () => {
  const a = actions();
  const t = contextMenuTemplate({ ...base, linkURL: 'https://example.com/', mediaType: 'image' }, a);
  expect(names(t)).toEqual(['Copy Link', 'separator', 'Copy Image']);
  t[0]!.click!({} as never, undefined, {} as never);
  t[2]!.click!({} as never, undefined, {} as never);
  expect(a.copyText).toHaveBeenCalledWith('https://example.com/');
  expect(a.copyImageAt).toHaveBeenCalledWith(10, 20);
});
