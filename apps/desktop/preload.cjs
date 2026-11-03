// Bridges the few things a browser page can't do. The UI must keep working
// without it (plain web), so every capability here is optional.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('accioDesktop', {
  serverOrigin: process.argv.find((arg) => arg.startsWith('--accio-server-origin='))?.slice('--accio-server-origin='.length),
  pickFolder: () => ipcRenderer.invoke('accio:pick-folder'),
  openFolder: (path) => ipcRenderer.invoke('accio:open-folder', path),
  openPreview: (url) => ipcRenderer.invoke('accio:open-preview', url),
});
