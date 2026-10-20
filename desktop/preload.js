const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('studioDesktop', {
  status: () => ipcRenderer.invoke('status'), startServer: () => ipcRenderer.invoke('start-server'), openPanel: () => ipcRenderer.invoke('open-panel'),
  setCfg: p => ipcRenderer.invoke('set-cfg', p), openPath: w => ipcRenderer.invoke('open-path', w)
});
