import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.pmw.tracker',
  appName: 'PMW Tracker',
  webDir: 'dist',
  android: {
    allowMixedContent: false
  }
};

export default config;
