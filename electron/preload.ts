import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Define secure APIs bridged from main to renderer here if needed
});
