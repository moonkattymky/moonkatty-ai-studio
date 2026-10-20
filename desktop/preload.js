// Minimal bridge, exposed ONLY on the bundled startup page (file://…/desktop/startup.html), never on the panel.
const { contextBridge, ipcRenderer } = require('electron');
if (location.protocol === 'file:' && /\/desktop\/startup\.html$/.test(location.pathname)) {
  contextBridge.exposeInMainWorld('studioDesktop', Object.freeze({
    status: () => ipcRenderer.invoke('status'),
    startServer: () => ipcRenderer.invoke('start-server'),
    openPanel: () => ipcRenderer.invoke('open-panel'),
    setAutoStart: v => ipcRenderer.invoke('set-cfg', { autoStartServer: v === true }),
    setStartAtLogin: v => ipcRenderer.invoke('set-cfg', { startAtLogin: v === true }),
    openPath: w => ipcRenderer.invoke('open-path', w === 'logs' ? 'logs' : 'data')
  }));
}
