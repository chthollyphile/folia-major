import { existsSync } from 'fs';
import { defineConfig } from '@playwright/test';

const loopbackNoProxy = '127.0.0.1,localhost,::1';
process.env.NO_PROXY = process.env.NO_PROXY ? `${process.env.NO_PROXY},${loopbackNoProxy}` : loopbackNoProxy;
process.env.no_proxy = process.env.no_proxy ? `${process.env.no_proxy},${loopbackNoProxy}` : loopbackNoProxy;

const chromiumCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
].filter((value): value is string => Boolean(value));

const chromiumExecutablePath = chromiumCandidates.find(candidate => existsSync(candidate));

export default defineConfig({
  testDir: './test/ui',
  fullyParallel: false,
  reporter: 'line',
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: {
      width: 1440,
      height: 1100,
    },
    trace: 'on-first-retry',
    launchOptions: {
      executablePath: chromiumExecutablePath,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
    },
  },
  webServer: {
    command: 'cross-env VITE_NETEASE_API_BASE=http://127.0.0.1:4173/__mock_netease__ npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
