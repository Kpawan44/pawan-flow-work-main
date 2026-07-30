# Installable PC + Android app, auto-updating, no hosting required

This is the fully local/free setup: no Render, no live server. The desktop
app runs its own bundled copy of the backend on the user's PC; the mobile
app has the whole web app bundled inside it. Both use the exact same
interface as the web app, since they're built from the same `dist/` output.

**Trade-off:** the one feature that needs a real live server — the AI
email-summary report — will show a friendly error instead of working. See
"Turning the AI email feature back on" at the bottom if you want it later.

---

## One-time setup

```bash
npm install
npx cap add android          # generates the android/ native project
git add android/ package.json package-lock.json
git commit -m "add android platform"
git push
```

In `package.json` → `"build" → "publish"`, replace `YOUR_GITHUB_USERNAME` /
`YOUR_REPO_NAME` with your actual GitHub username/repo — this is what both
release workflows below publish to.

That's it — two GitHub Actions workflows are already set up and will do the
rest automatically:
- `.github/workflows/release-desktop.yml` → builds Windows/Linux installers
- `.github/workflows/release-android.yml` → builds the Android APK

---

## Every time you want to ship an update

```bash
git add -A
git commit -m "describe your changes"
git push
git tag v1.0.1          # bump this each release
git push --tags
```

Pushing a tag triggers both workflows. A few minutes later, go to your
repo's **Releases** page on GitHub — you'll see a new release with:
- `*.exe` (Windows installer)
- `*.AppImage` / `*.deb` (Linux)
- `app-debug.apk` (Android)

## How each platform gets the update

**Desktop (Windows/Mac/Linux):** fully automatic. Everyone who already
installed the app checks GitHub on launch and silently downloads + installs
the new version in the background (via `electron-updater`). Nothing else
to do.

**Android:** since this is a directly-shared APK (not the Play Store),
there's no silent auto-update. Download `app-debug.apk` from the new
Release and send it to your users to reinstall over the old one — their
data isn't affected, only the app code updates. *(If you'd rather have true
silent auto-update on Android too, publish to the Play Store instead — ask
me and I'll set that up; it's a $25 one-time fee and needs a signed release
build instead of the debug one this workflow makes.)*

---

## Building locally instead of via GitHub Actions

```bash
npm run build                         # builds dist/
npm run build:electron-main
npm run electron:pack                 # installer lands in /release

npx cap sync android
npm run cap:android                   # opens Android Studio - Build > Build APK
```

---

## Turning the AI email feature back on later

That feature needs a real running server. Whenever you're ready:

1. Deploy the app somewhere that runs Docker containers (Render, Railway,
   Fly.io, Cloud Run — the included `Dockerfile` + `render.yaml` work with
   Render specifically, one click).
2. Put that URL in `app.config.json` → `"appUrl"`.
3. Rebuild/re-tag — both apps will now load the live site directly instead
   of the bundled copy, which also means every future update shows up
   instantly with no rebuild at all (for both desktop and mobile).

---

## Quick reference

| Target | How it updates | Cost |
|---|---|---|
| Windows/Mac/Linux | Automatic (electron-updater + GitHub Releases) | $0 |
| Android (as set up) | Manual reinstall of new APK from GitHub Releases | $0 |
| Android (Play Store, optional) | Automatic, like any Play Store app | $25 one-time |
| AI email feature | Off until you host it somewhere | $0 until then |
