import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        // 'autoUpdate' makes the service worker fetch + activate new builds
        // in the background and reload the page automatically, so installed
        // desktop/mobile/PWA users always end up on the latest version
        // without manually reinstalling anything.
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        manifest: false, // we ship our own public/manifest.json
        includeAssets: ['icon-192.png', 'icon-512.png', 'icon-1024.png'],
        workbox: {
          // Don't let the SW try to cache API calls to our own backend or
          // Firestore - those must always go to the network.
          navigateFallbackDenylist: [/^\/api\//],
          // Only precache small, fast-changing shell files. The app's main
          // JS bundle is a few MB (single-file App.tsx) - instead of trying
          // to precache it (which hits a hard size check), it's cached at
          // runtime below instead. Functionally equivalent for the user:
          // still offline-capable, still auto-updating.
          globPatterns: ['**/*.{html,css,ico,svg,json}'],
          runtimeCaching: [
            {
              urlPattern: /^\/api\//,
              handler: 'NetworkOnly',
            },
            {
              // Always try the network first for JS so users get the
              // newest code immediately when online; falls back to the
              // last cached copy when offline.
              urlPattern: /\.js$/,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'app-js-assets',
                networkTimeoutSeconds: 5,
              },
            },
          ],
        },
        devOptions: {
          enabled: false, // never register a SW in the AI Studio preview / `vite dev`
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
