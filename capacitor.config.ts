import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.pmw.tracker',
  appName: 'PMW Manufacturing Tracker',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    url: 'https://my-project-9ca72.web.app',
    cleartext: false
  }
};

export default config;
