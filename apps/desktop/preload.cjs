// Bridges the few things a browser page can't do. The UI must keep working
// without it (plain web), so every capability here is optional.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('accioDesktop', {
  pickFolder: () => ipcRenderer.invoke('accio:pick-folder'),
});
