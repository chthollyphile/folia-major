import type { CapacitorConfig } from '@capacitor/cli';

// Capacitor hosts the same Vite output used by Web and Electron.
const config: CapacitorConfig = {
  appId: 'top.izuna.foliamajor',
  appName: 'Folia',
  webDir: 'dist',
  bundledWebRuntime: false,
};

export default config;
