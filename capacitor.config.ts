import type { CapacitorConfig } from '@capacitor/cli';
import fs from 'fs';
import path from 'path';

// Reuse the same app.config.json the Electron app reads, so there's a
// single place to point every wrapped app (desktop + mobile) at your
// deployed web app.
let appUrl = '';
try {
  const raw = fs.readFileSync(path.join(__dirname, 'app.config.json'), 'utf-8');
  appUrl = JSON.parse(raw).appUrl || '';
} catch {
  // ignore - falls back to bundling dist/ locally below
}

const config: CapacitorConfig = {
  appId: 'com.pawan.pmwtracker',
  appName: 'PMW Manufacturing Tracker',
  // webDir is only used when NOT loading a remote server (see below) -
  // Capacitor still needs it to exist even in remote mode.
  webDir: 'dist',
  server: appUrl
    ? {
        // Loads your live deployed site directly inside the native shell.
        // The interface is byte-for-byte the same as the browser/PWA
        // version, and it updates instantly on every redeploy - no app
        // store submission needed for content/UI changes.
        url: appUrl,
        androidScheme: 'https',
        cleartext: false,
      }
    : {
        // No appUrl configured yet: falls back to bundling the static
        // `dist/` build inside the app. Note the AI email-summary feature
        // (server.ts /api routes) will not work in this mode since there's
        // no backend - set appUrl in app.config.json once you deploy to
        // get full functionality identical to the web app.
        androidScheme: 'https',
      },
};

export default config;
