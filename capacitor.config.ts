import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.pmw.tracker',
  appName: 'PMW Tracker',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: false,
    allowNavigation: [
      'https://pmw-tracker-928410476586.asia-south1.run.app',
      '*.run.app',
      '*.googleapis.com',
      '*.firebaseio.com',
      '*.web.app',
      '*.firebaseapp.com'
    ]
  }
};

export default config;
