// 画面（Web と同じコード）から使える PC 版の機能。src/app/platform.ts が読む
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tmjDesktop', {
  setFullscreen: (on) => ipcRenderer.invoke('fullscreen:set', !!on),
  isFullscreen: () => ipcRenderer.invoke('fullscreen:get'),
  quit: () => ipcRenderer.send('app:quit'),
  steam: {
    available: () => ipcRenderer.invoke('steam:available'),
    activateAchievement: (id) => ipcRenderer.invoke('steam:achievement', String(id)),
    authTicket: () => ipcRenderer.invoke('steam:ticket'),
    personaName: () => ipcRenderer.invoke('steam:name'),
    language: () => ipcRenderer.invoke('steam:language'),
    cloudRead: (name) => ipcRenderer.invoke('steam:cloud-read', String(name)),
    cloudWrite: (name, content) => ipcRenderer.invoke('steam:cloud-write', String(name), String(content)),
  },
});
