# Getting your installable PC + mobile apps (with auto-update)

This project now builds three things from **one codebase**, so the interface
is always identical everywhere:

1. **Installable web app (PWA)** — installs from the browser, works offline, auto-updates.
2. **Windows/Mac/Linux desktop app** — built with Electron, auto-updates.
3. **Android/iOS app** — built with Capacitor, wraps your live site so it's always in sync.

Do these in order. Steps 1–2 unlock everything else.

---

## Step 0 — Install dependencies

```bash
npm install
```

## Step 1 — Deploy the web app so it has a public URL

The desktop and mobile apps both work best when they load your **real, live
app** (same data, same interface, instant updates) instead of a copy baked
into the app itself. This repo is already set up for **Render.com** with a
`Dockerfile` and a `render.yaml` blueprint.

1. Push this project to a GitHub repo.
2. Go to [render.com](https://render.com) → **New** → **Blueprint** → connect
   your GitHub account → pick this repo. Render reads `render.yaml`
   automatically and creates the web service for you.
3. In the Render dashboard for that service → **Environment**, fill in the
   real values for: `GEMINI_API_KEY`, `ADMIN_EMAIL`, `SMTP_HOST`,
   `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (same ones you use in `.env.local`).
4. Deploy. You'll get a URL like `https://pmw-tracker.onrender.com`.

**Auto-deploy is already on** — `render.yaml` sets `autoDeploy: true`, so
every push to `main` redeploys automatically. There's also a CI workflow at
`.github/workflows/ci.yml` that typechecks + builds on every push/PR, so you
catch build errors before they reach Render. (If you'd rather only deploy
*after* CI passes, flip `autoDeploy` to `false` in `render.yaml`, create a
`RENDER_DEPLOY_HOOK_URL` secret in your GitHub repo settings from Render's
dashboard → Settings → Deploy Hook, and the included
`.github/workflows/deploy.yml` will take over.)

**Note:** the free Render plan spins down after ~15 min idle (first request
after that takes ~30s to wake up). Fine for internal use; upgrade to the
$7/mo Starter plan later if that ever matters.

Once deployed, open **`app.config.json`** in the project root and paste the URL in:

```json
{
  "appUrl": "https://pmw-tracker.onrender.com"
}
```

This one file controls both the desktop and mobile apps below. Leave it
blank and the desktop app will instead run its own bundled copy of the
server locally (mobile always needs a URL).

---

## Step 2 — The installable web app (PWA)

Already wired up — nothing extra to build. Just deploy (Step 1) and:

- On desktop Chrome/Edge: visit the site → an "Install" icon appears in the
  address bar → click it → it installs like a native app.
- On Android Chrome: "Add to Home screen" banner appears automatically.
- On iPhone Safari: Share → "Add to Home Screen".

**Auto-update:** every time you redeploy, the service worker downloads the
new version in the background and swaps it in automatically — users just
see the new version next time they reload, no reinstall needed.

---

## Step 3 — Windows / Mac / Linux desktop app

First, in `package.json` under `"build" → "publish"`, replace
`YOUR_GITHUB_USERNAME` / `YOUR_REPO_NAME` with your actual GitHub
username/repo (needed for both the manual and automatic release methods below).

```bash
# builds the web app + server, then packages an installer for your current OS
npm run electron:pack

# or build installers for all 3 platforms at once (needs the right OS/toolchains,
# typically only fully works on macOS for the Mac target)
npm run electron:pack:all
```

Installers land in `/release`:
- Windows: `PMW Manufacturing Tracker Setup x.x.x.exe`
- Mac: `.dmg`
- Linux: `.AppImage` / `.deb`

Send that installer file to anyone with the matching OS — double-click to install.

### Auto-update for the desktop app

The app checks for new versions on every launch and installs them silently
in the background (via `electron-updater`), publishing to GitHub Releases.

**Automatic (recommended):** `.github/workflows/release-desktop.yml` is
already set up — just tag a version and push:
```bash
git tag v1.0.1
git push --tags
```
GitHub Actions builds the Windows + Linux installers and publishes them as
a GitHub Release automatically (no setup needed beyond having pushed this
repo to GitHub — it uses the built-in `GITHUB_TOKEN`). Every installed copy
of the app finds that release and updates itself.

**Manual (alternative):** run this yourself instead of tagging:
```bash
npx electron-builder --publish always
```
(needs a `GH_TOKEN` env var with a GitHub personal access token, and
`"owner"`/`"repo"` filled in under `package.json → build → publish`).

*(If you set `appUrl` in Step 1, the on-screen content already updates
instantly on every redeploy — you'd only need to publish a new desktop
release if you change native/Electron code, not for regular feature updates.)*

---

## Step 4 — Android / iOS app

This wraps your live deployed site (Step 1) in a real native app shell —
same interface as the web app, pixel for pixel, and it updates instantly
whenever you redeploy since it's just loading the live page.

```bash
npm run build          # builds dist/ (used as a fallback + required by Capacitor)
npx cap add android     # first time only
npx cap add ios         # first time only, macOS only
npx cap sync
```

### Android

```bash
npm run cap:android     # opens the project in Android Studio
```
In Android Studio: **Build → Generate Signed Bundle / APK** → follow the
wizard to create a signing key → produces an installable `.apk` (share it
directly - "sideloading") or `.aab` (for the Google Play Store).

### iOS

```bash
npm run cap:ios          # opens the project in Xcode (macOS + Xcode required)
```
In Xcode: sign in with your Apple ID under Signing & Capabilities, then
**Product → Archive** to produce a build for TestFlight/App Store, or run
directly on a connected iPhone for personal use.

### "Auto-update" for mobile

Because the app just displays your live website, **all UI and data changes
appear instantly** with no app update at all. You only need to rebuild/resubmit
the app itself if you add a native plugin or change `capacitor.config.ts`.

---

## Quick reference

| Target | Command | Output | Updates via |
|---|---|---|---|
| PWA | (just deploy) | installable from browser | service worker, automatic |
| Windows/Mac/Linux | `npm run electron:pack` | `/release/*.exe .dmg .AppImage` | electron-updater (GitHub Releases) |
| Android | `npm run cap:android` → Android Studio | `.apk` / `.aab` | live URL (instant) + Play Store for shell updates |
| iOS | `npm run cap:ios` → Xcode | TestFlight/App Store build | live URL (instant) + App Store for shell updates |
