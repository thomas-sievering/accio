// Exercise the built renderer in Electron without opening a visible window or touching real user state.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
// Exercise the real preload/URL validation while recording the OS-browser boundary.
ipcMain.handle('accio:open-preview', async (event, input) => {
  const { previewUrl } = await import(pathToFileURL(path.resolve('apps/desktop/dist/openPreview.js')).href);
  app.chatPreviews.push(previewUrl(event.senderFrame?.url, new URL(process.env.ACCIO_CHAT_TEST_URL).origin, input));
});
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, width: 1280, height: 900,
    webPreferences: { preload: path.resolve('apps/desktop/preload.cjs'), backgroundThrottling: false },
  });
  app.chatDownloads = [];
  app.chatPreviews = [];
  win.webContents.session.on('will-download', (_event, item) => {
    // Electron downloads are native DownloadItems; keep them inside this test's temporary profile.
    const destination = path.join(process.env.ACCIO_CHAT_TEST_DOWNLOADS, item.getFilename());
    item.setSavePath(destination);
    item.once('done', (_doneEvent, state) => app.chatDownloads.push({ name: item.getFilename(), path: destination, state }));
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await win.loadURL(`${process.env.ACCIO_CHAT_TEST_URL}/#token=isolated-chat-test-token`);
});
app.on('window-all-closed', () => app.quit());
