import type { MenuItemConstructorOptions, WebContents } from 'electron';

/**
 * The hidden menu bar's shortcuts: Electron's default menu minus Window → Close, whose
 * Ctrl/Cmd+W closed the only window and so quit Accio and interrupted its turns.
 * Ctrl/Cmd+W closes focused DevTools instead and otherwise does nothing.
 */
export function appMenuTemplate(platform: NodeJS.Platform, allContents: () => WebContents[]): MenuItemConstructorOptions[] {
  const mac = platform === 'darwin';
  return [
    // macOS's File menu holds Close (Cmd+W), so it gets only the app menu (About, Hide, Quit).
    mac ? { role: 'appMenu' } : { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    {
      role: 'windowMenu',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(mac ? [{ type: 'separator' as const }, { role: 'front' as const }] : []),
        {
          label: 'Close Developer Tools',
          accelerator: 'CmdOrCtrl+W',
          visible: false,
          click: () => allContents().find((contents) => !contents.isDestroyed() && contents.isDevToolsFocused())?.closeDevTools(),
        },
      ],
    },
  ];
}
