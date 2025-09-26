// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  createOverlay: () => ipcRenderer.invoke('create-overlay'),
  startWatching: (bounds: any) => ipcRenderer.invoke('start-watching', bounds),
  stopWatching: () => ipcRenderer.invoke('stop-watching'),
  getWatchingStatus: () => ipcRenderer.invoke('get-watching-status'),
  getOverlayBounds: () => ipcRenderer.invoke('get-overlay-bounds'),
  checkScreenPermissions: () => ipcRenderer.invoke('check-screen-permissions'),
  onScreenChangeDetected: (callback: any) => {
    ipcRenderer.on('screen-change-detected', callback);
  },
  removeScreenChangeListener: () => {
    ipcRenderer.removeAllListeners('screen-change-detected');
  }
});
