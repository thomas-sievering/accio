import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, screen, shell, systemPreferences, type NativeImage } from 'electron';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkerProcess, type Ready } from './workerProcess.js';
import { readFileSync, writeFileSync } from 'node:fs';
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
    const whole = await captureWindow(win);
    const image = 'image' in whole ? whole.image : await win.webContents.capturePage();
    if (image.isEmpty()) throw new Error('The window captured as empty; it may be hidden.');
    const note = 'image' in whole ? undefined : `Captured the page only, without the window's title bar buttons: ${whole.reason}`;
    reply({ type: 'captured', id: message.id, png: image.toPNG().toString('base64'), ...(note ? { note } : {}) });
  } catch (error) {
    reply({ type: 'captured', id: message.id, error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * The whole window as the OS draws it, with its native close, minimize and maximize buttons,
 * which `capturePage` leaves out because they aren't part of the page. Otherwise why the OS
 * wouldn't give it: macOS needs Screen Recording permission, and asking would put a prompt on a
 * machine nobody may be sitting at, so without it the page alone is captured.
 */
async function captureWindow(win: BrowserWindow): Promise<{ image: NativeImage } | { reason: string }> {
  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('screen');
    if (status !== 'granted') {
      return { reason: `Screen Recording permission is ${status} for ${appBundle()}. Allow it in System Settings → Privacy & Security → Screen & System Audio Recording, then restart Accio. If Accio was started from a terminal, allow that terminal app instead.` };
    }
  }
  try {
    const bounds = win.getBounds();
    const { scaleFactor } = screen.getDisplayMatching(bounds);
    const thumbnailSize = { width: Math.round(bounds.width * scaleFactor), height: Math.round(bounds.height * scaleFactor) };
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize });
    // `window:<id>:<n>`: the trailing number can differ between the two on macOS, the window id can't.
    const windowId = (id: string) => id.split(':').slice(0, 2).join(':');
    const source = sources.find((candidate) => windowId(candidate.id) === windowId(win.getMediaSourceId()));
    if (!source) return { reason: `the OS listed ${sources.length} windows, none of them Accio's (${win.getMediaSourceId()}).` };
    if (source.thumbnail.isEmpty()) return { reason: 'the OS returned an empty image of the window.' };
    return { image: source.thumbnail };
  } catch (error) {
    return { reason: `capturing the window failed: ${error instanceof Error ? error.message : String(error)}.` };
  }
}

/** The app macOS asks Screen Recording permission for: the .app bundle this Electron runs from. */
function appBundle() {
  const bundle = process.execPath.match(/^(.*?\.app)\//)?.[1];
  return bundle ?? process.execPath;
}

type WindowState = { x: number; y: number; width: number; height: number; maximized: boolean };
const windowStateFile = () => join(app.getPath('userData'), 'window-state.json');

/** Where the window was when it last closed, if that spot is still on a connected display. */
function savedWindowState(): WindowState | undefined {
  try {
    const state = JSON.parse(readFileSync(windowStateFile(), 'utf8')) as WindowState;
    if (![state.x, state.y, state.width, state.height].every(Number.isFinite)) return undefined;
    const area = screen.getDisplayMatching(state).workArea;
    const visible = state.x < area.x + area.width && state.x + state.width > area.x && state.y < area.y + area.height && state.y + state.height > area.y;
    return visible ? state : undefined;
  } catch {
    return undefined;
  }
}

/** Remembers the window's size, position and maximized state for the next launch. */
function rememberWindowState(win: BrowserWindow) {
  const save = () => {
    if (win.isDestroyed() || win.isMinimized()) return;
    const state: WindowState = { ...win.getNormalBounds(), maximized: win.isMaximized() };
    try { writeFileSync(windowStateFile(), JSON.stringify(state)); } catch (error) { console.error(error); }
  };
  let timer: NodeJS.Timeout | undefined;
  const later = () => { clearTimeout(timer); timer = setTimeout(save, 500); };
  win.on('resize', later);
  win.on('move', later);
  win.on('maximize', save);
  win.on('unmaximize', save);
  win.on('close', () => { clearTimeout(timer); save(); });
}

async function createWindow(ready: Ready) {
  const state = savedWindowState();
  const win = new BrowserWindow({
    ...(state ? { x: state.x, y: state.y, width: state.width, height: state.height } : { width: 1280, height: 840 }),
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
  if (state?.maximized) win.maximize();
  rememberWindowState(win);
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
