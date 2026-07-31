import { app, BrowserWindow, dialog } from 'electron';
import path from 'path';
import { fork, ChildProcess } from 'child_process';
import fs from 'fs';
import http from 'http';
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

function waitForServer(url: string, timeoutMs = 15000, intervalMs = 250): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.destroy();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() > deadline) {
          reject(new Error(`Server at ${url} did not respond within ${timeoutMs}ms`));
        } else {
          setTimeout(attempt, intervalMs);
        }
      });
    };
    attempt();
  });
}

function startBundledServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const serverPath = app.isPackaged
      ? path.join(process.resourcesPath, 'app', 'dist', 'server.cjs')
      : path.join(__dirname, '..', 'dist', 'server.cjs');

    if (!fs.existsSync(serverPath)) {
      reject(new Error(`Bundled server not found at ${serverPath}. Run "npm run build" first.`));
      return;
    }

    const staticDir = app.isPackaged
      ? path.join(process.resourcesPath, 'app-dist')
      : path.join(__dirname, '..', 'dist');

    serverProcess = fork(serverPath, [], {
      env: {
        ...process.env,
        PORT: String(LOCAL_PORT),
        NODE_ENV: 'production',
        STATIC_DIR: staticDir,
      },
      silent: true,
    });

    serverProcess.stdout?.on('data', (d) => console.log(`[server] ${d}`));
    serverProcess.stderr?.on('data', (d) => console.error(`[server] ${d}`));
    serverProcess.on('error', reject);
    serverProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`Bundled server exited early with code ${code}`));
      }
    });

    // Actually wait for the server to respond instead of guessing with a
    // fixed delay - avoids a race where the window tries to load the page
    // before the server has bound the port.
    waitForServer(`http://localhost:${LOCAL_PORT}`).then(resolve, reject);
  });
}

async function createWindow() {
  const config = readAppConfig();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
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

  // Safety net: if the very first load still somehow fails (e.g. dev server
  // not up yet), retry a few times instead of getting stuck on Chromium's
  // error page.
  let retriesLeft = 5;
  mainWindow.webContents.on('did-fail-load', () => {
    if (retriesLeft > 0 && mainWindow) {
      retriesLeft -= 1;
      setTimeout(() => mainWindow?.loadURL(targetUrl), 500);
    }
  });

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
