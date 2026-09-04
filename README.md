<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# PMW Tracker - Manufacturing Operations & Automation

PMW Tracker is an Android enterprise application built with Kotlin, Jetpack Compose, Room Database, and Gemini AI. It streamlines shop-floor job card tracking, material transfers across 8 factory departments (Purchase, Raw Material Store, Production, Heat Treatment, Plating, Packing, Store, Dispatch), subcontractor outsource tracking, and autonomous AI-driven line optimization.

---

## 📱 Mobile APK Installation & Deployment Guide

Follow these steps to install the APK directly onto an Android phone:

### 1. Download the APK
- In the **Google AI Studio** top bar, click the export/settings menu.
- Choose **Download APK** (or build the APK via Gradle).

### 2. Signing Configuration Details
- **Properly Signed Builds**: Both `debug` and `release` build variants are explicitly linked to `signingConfigs.getByName("debug")` in `app/build.gradle.kts`. This guarantees that both debug and release APK exports carry valid Android APK v1 and v2 certificate signatures, preventing `INSTALL_PARSE_FAILED_NO_CERTIFICATES` errors.
- **Bundle Version**:
  - `applicationId`: `com.aistudio.pmwtracker.mfrfld`
  - `minSdk`: `26` (Android 8.0 Oreo or newer)
  - `targetSdk`: `36`
  - `versionCode`: `2`
  - `versionName`: `1.0.1`

### 3. Resolving Phone Installation Blocks
If you encounter errors when installing the APK on your phone:

1. **"App not installed" / Package Signature Conflict**:
   - If you had an older or different development build installed previously, **uninstall the existing app completely** from your phone before installing the new APK.
2. **"Install unknown apps" Permission**:
   - Android blocks APK installations from unauthorized apps (like Chrome, Drive, or Files) by default.
   - Go to **Settings > Apps > Special app access > Install unknown apps**, select the browser or file manager you used to open the APK, and toggle **Allow from this source**.
3. **Google Play Protect Warning ("Blocked by Play Protect" / "Unsafe App")**:
   - Because this APK is signed with a development key and sideloaded (not downloaded from the Play Store), Play Protect may display a warning dialog.
   - Tap **More details** (small text below the warning) and tap **Install anyway**.

---

## 💻 Local Development & Gradle Build Steps

### Prerequisites
- **Android Studio**: Jellyfish (2023.3.1), Koala, Ladybug, or newer
- **JDK**: Java 21
- **Android SDK**: API level 26 to 36

### Building from Source
```bash
# 1. Clone or export the project repository
git clone <repository-url>
cd <project-folder>

# 2. Build Debug APK (Signed with debug keystore)
./gradlew :app:assembleDebug

# 3. Build Release APK (Signed with configured keystore)
./gradlew :app:assembleRelease

# 4. Install directly to a connected USB or Wi-Fi device via ADB
adb install -r app/build/outputs/apk/debug/app-debug.apk
# or release variant:
adb install -r app/build/outputs/apk/release/app-release.apk
```

---

## 🔑 Environment & Secrets Configuration
- **Gemini API Key**: Set your Gemini API key in the AI Studio **Secrets** panel or configure it as an environment variable `GEMINI_API_KEY`. It is securely injected into `BuildConfig.GEMINI_API_KEY` at build time.
