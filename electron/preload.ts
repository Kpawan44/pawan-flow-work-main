import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Get the current app version
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Listen for update-available event from main process
  onUpdateAvailable: (callback: (version: string) => void) => {
    ipcRenderer.on('update-available', (_event, version) => callback(version));
  },
});
