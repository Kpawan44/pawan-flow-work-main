<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/26686e2f-bae2-4ef1-b72c-d130608b7e90

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Installable PC & mobile apps (auto-updating)

See [`BUILD_AND_DEPLOY.md`](./BUILD_AND_DEPLOY.md) for step-by-step
instructions to deploy this app and build:
- an installable, auto-updating **PWA**
- an installable **Windows/Mac/Linux desktop app** (Electron, auto-updates)
- an installable **Android/iOS app** (Capacitor) with the identical interface
