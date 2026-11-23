import type { MenuItemConstructorOptions, WebContents } from 'electron';
import { expect, it, vi } from 'vitest';
import { appMenuTemplate } from './appMenu.js';

const flatten = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] =>
  items.flatMap((item) => [item, ...(Array.isArray(item.submenu) ? flatten(item.submenu) : [])]);

it('keeps the Windows menu roles and the hidden DevTools accelerator', () => {
  const template = appMenuTemplate('win32', () => []);
  expect(template.map((item) => item.role)).toEqual(['fileMenu', 'editMenu', 'viewMenu', 'windowMenu']);
  expect(flatten(template)).toContainEqual(expect.objectContaining({
    label: 'Close Developer Tools',
    accelerator: 'CmdOrCtrl+W',
    visible: false,
  }));
});

it.each(['win32', 'darwin', 'linux'] as const)('on %s, Ctrl/Cmd+W closes focused DevTools and never the window', (platform) => {
  const contents = (devToolsFocused: boolean) => ({ isDestroyed: () => false, isDevToolsFocused: () => devToolsFocused, closeDevTools: vi.fn() });
  const app = contents(false);
  const inspected = contents(true);
  let all = [app, inspected];
  const items = flatten(appMenuTemplate(platform, () => all as unknown as WebContents[]));

  // Role menus without their own submenu bring Electron's default items, Close among them
  // (macOS's File menu is only Close).
  const closesWindow = (item: MenuItemConstructorOptions) =>
    item.role === 'close' || (item.role === 'windowMenu' && !item.submenu) || (platform === 'darwin' && item.role === 'fileMenu');
  expect(items.filter(closesWindow)).toEqual([]);
  expect(items.filter((item) => item.accelerator?.toLowerCase().endsWith('+w')).map((item) => item.label)).toEqual(['Close Developer Tools']);
  expect(items.map((item) => item.role)).toEqual(expect.arrayContaining(['editMenu', 'viewMenu']));

  const closeTools = items.find((item) => item.label === 'Close Developer Tools')!;
  closeTools.click!(undefined as never, undefined, undefined as never);
  expect(inspected.closeDevTools).toHaveBeenCalledTimes(1);
  expect(app.closeDevTools).not.toHaveBeenCalled();

  all = [app];
  closeTools.click!(undefined as never, undefined, undefined as never);
  expect(app.closeDevTools).not.toHaveBeenCalled();
});
