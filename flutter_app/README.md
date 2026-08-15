# MFR Manufacturing ERP - Flutter Android App

This is the native **Flutter Android** application for the MFR Manufacturing Job Card & Material Movement ERP System.

## Features
- **Flutter Material 3 UI** optimized for Android Phones and Tablets (Phone Layout & Tablet NavigationRail)
- **Real-Time Data Sync** with Firebase Firestore backend and APIs
- **Offline Data Sync Queue** with automatic background retry when connection is restored
- **Barcode & QR Label Scanner** integration using mobile_scanner
- **Job Card & Order Management** with live department tracking
- **WhatsApp Notification Integration**
- **Secure Authentication & Role-Based Access**

## How to Build the Android APK

1. Install Flutter SDK (3.x or later):
```bash
flutter doctor
```

2. Navigate to the `flutter_app` folder:
```bash
cd flutter_app
```

3. Install dependencies:
```bash
flutter pub get
```

4. Run the app on a connected Android phone or emulator:
```bash
flutter run
```

5. Build production Release Android APK:
```bash
flutter build apk --release
```
The compiled APK will be located at `build/app/outputs/flutter-apk/app-release.apk`.
