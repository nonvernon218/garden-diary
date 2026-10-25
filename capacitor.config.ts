import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.gardendiary.local',
  appName: '园丁日记',
  webDir: 'dist',
  android: { allowMixedContent: false },
  plugins: {
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
      style: 'DARK',
      hidden: false,
    },
  },
};

export default config;
