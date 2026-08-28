import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

let autoUpdater: any = null;
try {
  const updaterModule = require('electron-updater');
  autoUpdater = updaterModule?.autoUpdater || updaterModule;
} catch (e) {
  console.log('electron-updater not available in current environment');
}

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.cjs');

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: preloadPath,
      webSecurity: false,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Check for updates automatically in production
  if (!app.isPackaged && process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    const indexPath = path.join(app.getAppPath(), 'dist', 'index.html');
    mainWindow.loadFile(indexPath).catch(() => {
      mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    });
    if (autoUpdater && typeof autoUpdater.checkForUpdatesAndNotify === 'function') {
      autoUpdater.checkForUpdatesAndNotify().catch((err: any) => {
        console.log('Auto-updater check skipped or failed:', err);
      });
    }
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

