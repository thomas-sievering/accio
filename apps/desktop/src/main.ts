import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ServerProcess, type Ready } from './serverProcess.js';
import { stat } from 'node:fs/promises';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let server: ServerProcess | undefined;
let localServerOrigin: string | undefined;
let quitting = false;
let quitAllowed = false;

/** The last window closing quits the app and interrupts the local machine's turns. */
function startServer(): Promise<Ready> {
  const entry = require.resolve('@accio/server');
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  child.stderr?.on('data', (d) => process.stderr.write(d));
  server = new ServerProcess(child, (error) => {
    console.error(error);
    dialog.showErrorBox('accio server stopped', `${error.message}. Quit and reopen accio to reconnect. Interrupted threads can be resumed.`);
    app.quit();
  });
  child.stdout?.on('data', (d) => process.stdout.write(d));
  return server.ready;
}

async function createWindow(ready: Ready) {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    backgroundColor: '#1d1d1d',
    title: 'accio',
    autoHideMenuBar: true,
    // Same chrome as botbot: native caption buttons over a hidden title bar.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#d4d4d4', height: 52 },
    webPreferences: {
      preload: join(here, '../preload.cjs'),
      additionalArguments: [`--accio-server-origin=${new URL(ready.url).origin}`],
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  const base = process.env.ACCIO_DEV_URL ?? ready.url;
  await win.loadURL(`${base}/#token=${encodeURIComponent(ready.token)}`);
}

ipcMain.handle('accio:pick-folder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const opts = { properties: ['openDirectory' as const] };
  const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

ipcMain.handle('accio:open-folder', async (event, path: unknown) => {
  if (!event.senderFrame || new URL(event.senderFrame.url).origin !== localServerOrigin) {
    throw new Error('Only folders on this desktop machine can be opened in Explorer.');
  }
  if (typeof path !== 'string' || !isAbsolute(path) || !(await stat(path)).isDirectory()) {
    throw new Error('Folder does not exist.');
  }
  const error = await shell.openPath(path);
  if (error) throw new Error(error);
});

app.whenReady().then(async () => {
  try {
    const ready = await startServer();
    localServerOrigin = new URL(ready.url).origin;
    await createWindow(ready);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow(ready);
    });
  } catch (err) {
    console.error(err);
    app.quit();
  }
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  if (quitAllowed) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  void (server?.close() ?? Promise.resolve()).finally(() => {
    quitAllowed = true;
    app.quit();
  });
});
