import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stat } from 'node:fs/promises';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

type Ready = { url: string; token: string };

let server: ChildProcess | undefined;
let localServerOrigin: string | undefined;

/**
 * The desktop app carries the local machine's server (GLOSSARY: Client holds no
 * threads of its own). It runs as a separate process under Electron's Node, so
 * closing a window never stops a turn, and quitting the app does.
 */
function startServer(): Promise<Ready> {
  const entry = require.resolve('@accio/server');
  server = spawn(process.execPath, [entry], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  server.stderr?.on('data', (d) => process.stderr.write(d));
  return new Promise((resolve, reject) => {
    let buffer = '';
    server!.stdout?.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk);
      buffer += chunk.toString();
      const match = buffer.match(/^ACCIO_READY (.+)$/m);
      if (match?.[1]) resolve(JSON.parse(match[1]) as Ready);
    });
    server!.once('exit', (code) => reject(new Error(`accio server exited with code ${code}`)));
  });
}

async function createWindow(ready: Ready) {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    backgroundColor: '#18191d',
    title: 'accio',
    autoHideMenuBar: true,
    // Same chrome as botbot: native caption buttons over a hidden title bar.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#898a92', height: 52 },
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
app.on('quit', () => server?.kill());
