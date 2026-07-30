import { app, BrowserWindow, dialog } from 'electron';
import path from 'path';
import { fork, ChildProcess } from 'child_process';
import fs from 'fs';
import { autoUpdater } from 'electron-updater';

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
const LOCAL_PORT = 3000;

function readAppConfig(): { appUrl: string } {
  try {
    // In dev this file sits at the project root; in a packaged build it is
    // copied alongside the app resources.
    const devPath = path.join(__dirname, '..', 'app.config.json');
    const prodPath = path.join(process.resourcesPath, 'app.config.json');
    const configPath = fs.existsSync(devPath) ? devPath : prodPath;
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { appUrl: '' };
  }
}

function startBundledServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const serverPath = app.isPackaged
      ? path.join(process.resourcesPath, 'server.cjs')
      : path.join(__dirname, '..', 'dist', 'server.cjs');

    if (!fs.existsSync(serverPath)) {
      reject(new Error(`Bundled server not found at ${serverPath}. Run "npm run build" first.`));
      return;
    }

    serverProcess = fork(serverPath, [], {
      env: { ...process.env, PORT: String(LOCAL_PORT), NODE_ENV: 'production' },
      silent: true,
    });

    serverProcess.stdout?.on('data', (d) => console.log(`[server] ${d}`));
    serverProcess.stderr?.on('data', (d) => console.error(`[server] ${d}`));
    serverProcess.on('error', reject);

    // Give the server a moment to bind the port, then just proceed - the
    // BrowserWindow will retry loading if it's not ready yet.
    setTimeout(resolve, 700);
  });
}

async function createWindow() {
  const config = readAppConfig();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  let targetUrl: string;

  if (config.appUrl) {
    // Preferred: load the live deployed web app. Same interface as the
    // browser version, and content updates the instant you redeploy -
    // no app update required at all.
    targetUrl = config.appUrl;
  } else if (process.env.NODE_ENV === 'development') {
    targetUrl = 'http://localhost:3000';
  } else {
    // Fallback: run the bundled Express server locally and point at it.
    try {
      await startBundledServer();
      targetUrl = `http://localhost:${LOCAL_PORT}`;
    } catch (err) {
      dialog.showErrorBox('Failed to start app', String(err));
      app.quit();
      return;
    }
  }

  mainWindow.loadURL(targetUrl);
}

app.whenReady().then(async () => {
  await createWindow();

  // Silently checks for a newer installer (see the "publish" config in
  // package.json), downloads it in the background, and installs it the
  // next time the app restarts.
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.error('Auto-update check failed:', err);
    });
  }
});

app.on('window-all-closed', () => {
  serverProcess?.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  serverProcess?.kill();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
