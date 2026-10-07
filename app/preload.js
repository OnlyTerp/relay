const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desk', {
  toggle: (a) => ipcRenderer.send('toggle', a),
  open: (a) => ipcRenderer.send('open', a),
  hide: () => ipcRenderer.send('hide'),
  focusSid: (sid) => ipcRenderer.send('focus-sid', sid),
  dockLayout: (l) => ipcRenderer.send('dock-layout', l),
  talk: (on) => ipcRenderer.send('talk', on),
  screenshot: () => ipcRenderer.invoke('screenshot'),
  info: () => ipcRenderer.invoke('info'),
  set: (patch) => ipcRenderer.invoke('set', patch),
  checkHotkey: (k) => ipcRenderer.invoke('check-hotkey', k),
  installHooks: () => ipcRenderer.invoke('install-hooks'),
  openExternal: (u) => ipcRenderer.send('open-external', u),
  quit: () => ipcRenderer.send('quit'),
  on: (ch, fn) => ipcRenderer.on(ch, (_e, d) => fn(d)),
});
