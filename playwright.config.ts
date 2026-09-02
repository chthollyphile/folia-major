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
  fullyParallel: false,
  reporter: 'line',
  timeout: 90_000,
  expect: {
    timeout: 15_000,
    // 多 worker 并行时 CPU 争用会让个别文字标签的抗锯齿/过渡落定结果有微小出入，
    // 实测抖动量级在 ~115px。真实 UI 变化的量级完全不同（基线过期时是 80 万像素），
    // 所以这个容差不会掩盖回归。
    toHaveScreenshot: {
      maxDiffPixels: 600,
    },
  },
  // 与 Playwright 的默认模板只差一处：去掉 {-projectName}。拆 project 之前基线就叫
  // `local-library-linux.png`，跟着改名等于把三张基线作废，而它们和 project 划分毫无关系。
  // {snapshotDir} 缺省等于 project 的 testDir；{testFileDir} 是从 testDir 到测试文件的目录段，
  // 平铺时为空——所以它不能单独当前缀用。
  snapshotPathTemplate: '{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}{-snapshotSuffix}{ext}',
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
  projects: [
    {
      name: 'e2e',
      testDir: './test/ui',
    },
    {
      // 组件测试走 @playwright/test 内置的 mount fixture。它会导航到 baseURL，所以 baseURL
      // 必须是 gallery 页本身，而不是应用根。
      name: 'components',
      testDir: './test/component',
      use: {
        baseURL: 'http://127.0.0.1:4173/dev-probe.html',
        // 应用在 dev 下也注册 service worker（vite.config.ts 的 VitePWA devOptions.enabled）。
        // 不拦住它，缓存响应会盖掉 page.route() 的桩。
        serviceWorkers: 'block',
      },
    },
  ],
  // 刻意不开 reuseContext（Playwright 的 component testing skill 推荐开）。这批用例的逐条隔离
  // 靠的是每次导航时 addInitScript 里的 localStorage.clear()：共享 context 会让 init script
  // 累积、localStorage 跨用例串。8 个 spec 省下的那点时间不值这个风险。
  webServer: {
    command: 'cross-env VITE_NETEASE_API_BASE=http://127.0.0.1:4173/__mock_netease__ npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
