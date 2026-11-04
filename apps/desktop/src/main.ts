import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkerProcess, type Ready } from './workerProcess.js';
import { stat } from 'node:fs/promises';
import { previewUrl } from './openPreview.js';
import type { DesktopMessage } from '@accio/worker/dist/machine/desktop.js';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// A separate home (e.g. `pnpm try`) gets its own window state, so two copies never share a cache.
if (process.env.ACCIO_HOME) app.setPath('userData', join(process.env.ACCIO_HOME, 'desktop'));

let worker: WorkerProcess | undefined;
let localServerOrigin: string | undefined;
let quitting = false;
let quitAllowed = false;
let workerOutput = '';

/** The last window closing quits the app and interrupts the local machine's turns. */
function startWorker(): Promise<Ready> {
  const entry = require.resolve('@accio/worker');
  const child = spawn(process.execPath, [entry], {
    // ACCIO_DESKTOP: the worker may ask this process to restart the app or capture its window.
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ACCIO_DESKTOP: '1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  child.stderr?.on('data', (d) => { process.stderr.write(d); workerOutput = (workerOutput + d).slice(-2000); });
  worker = new WorkerProcess(child, (error) => {
    console.error(error);
    dialog.showErrorBox('accio worker stopped', `${error.message}. Quit and reopen accio to reconnect. Interrupted threads can be resumed.`);
    app.quit();
  });
  child.stdout?.on('data', (d) => process.stdout.write(d));
  child.on('message', (message: DesktopMessage) => { void answerWorker(message, (reply) => child.send(reply)); });
  return worker.ready;
}

/** GLOSSARY: Update and App screenshot. What the worker asks of the app it runs in. */
async function answerWorker(message: DesktopMessage, reply: (message: DesktopMessage) => void) {
  if (message?.type === 'relaunch') {
    // The same Electron and app folder start again once this one has quit as usual.
    app.relaunch();
    app.quit();
    return;
  }
  if (message?.type !== 'capture') return;
  try {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error('Accio has no open window.');
    if (win.isMinimized()) win.restore();
    if (message.script) {
      await win.webContents.executeJavaScript(message.script, true);
      // Lets the view the script opened finish rendering.
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    const image = await win.webContents.capturePage();
    if (image.isEmpty()) throw new Error('The window captured as empty; it may be hidden.');
    reply({ type: 'captured', id: message.id, png: image.toPNG().toString('base64') });
  } catch (error) {
    reply({ type: 'captured', id: message.id, error: error instanceof Error ? error.message : String(error) });
  }
}

async function createWindow(ready: Ready) {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    backgroundColor: '#18191d',
    title: process.env.ACCIO_WINDOW_TITLE ?? 'accio',
    icon: join(here, '../icon.ico'),
    autoHideMenuBar: true,
    // Same chrome as botbot: native caption buttons over a hidden title bar.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#898a92', height: 52 },
    webPreferences: {
      preload: join(here, '../preload.cjs'),
      additionalArguments: [`--accio-server-origin=${new URL(ready.url).origin}`],
    },
  });
  // `pnpm try` names its window after the checkout so it stands apart from the real one.
  if (process.env.ACCIO_WINDOW_TITLE) win.on('page-title-updated', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  const base = process.env.ACCIO_DEV_URL ?? ready.url;
  await win.loadURL(`${base}/#token=${encodeURIComponent(ready.token)}`);
}

ipcMain.handle('accio:open-preview', async (event, url: unknown) => {
  await shell.openExternal(previewUrl(event.senderFrame?.url, localServerOrigin, url));
});

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

// Its own taskbar group on Windows, so the accio icon isn't merged into another Electron app's;
// a `pnpm try` window keeps a separate group from the real one.
if (process.platform === 'win32') app.setAppUserModelId(process.env.ACCIO_WINDOW_TITLE ? `accio.${process.env.ACCIO_WINDOW_TITLE}` : 'accio');

app.whenReady().then(async () => {
  try {
    const ready = await startWorker();
    localServerOrigin = new URL(ready.url).origin;
    await createWindow(ready);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow(ready);
    });
  } catch (err) {
    console.error(err);
    const reason = workerOutput.match(/^Error: .+$/m)?.[0].slice(7) ?? String(err);
    dialog.showErrorBox('accio could not start', reason);
    app.quit();
  }
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  if (quitAllowed) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  void (worker?.close() ?? Promise.resolve()).finally(() => {
    quitAllowed = true;
    app.quit();
  });
});
