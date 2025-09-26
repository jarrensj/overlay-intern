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
  getMonitoringAreaBounds: () => ipcRenderer.invoke('get-monitoring-area-bounds'),
  checkScreenPermissions: () => ipcRenderer.invoke('check-screen-permissions'),
  debugCaptureArea: (bounds: any) => ipcRenderer.invoke('debug-capture-area', bounds),
  onScreenChangeDetected: (callback: any) => {
    ipcRenderer.on('screen-change-detected', callback);
  },
  removeScreenChangeListener: () => {
    ipcRenderer.removeAllListeners('screen-change-detected');
  },
  onMonitoringAutoStopped: (callback: any) => {
    ipcRenderer.on('monitoring-auto-stopped', callback);
  },
  removeMonitoringAutoStoppedListener: () => {
    ipcRenderer.removeAllListeners('monitoring-auto-stopped');
  },
  setTextDetection: (enabled: boolean, words: string[]) => ipcRenderer.invoke('set-text-detection', enabled, words),
  getTextDetectionSettings: () => ipcRenderer.invoke('get-text-detection-settings')
});
