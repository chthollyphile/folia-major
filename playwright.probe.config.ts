import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config';

// playwright.probe.config.ts
// Runs the *.probe.ts measurement files, which are deliberately excluded from `npm run test:ui`.
// A render count is only attributable on a machine that is not otherwise busy: under the parallel
// suite the app never goes idle, and the numbers stop meaning anything. One worker, on purpose.
//
// 必须自己定义 project：base config 拆成 e2e / components 之后，顶层的 testMatch 对 project 内的
// 用例不再生效，照抄 `...baseConfig` 会连带把那两个 project 拉进来，测量文件反而一个都跑不到。
export default defineConfig({
  ...baseConfig,
  projects: [
    {
      name: 'render-probe',
      testDir: './test/ui',
      testMatch: '**/*.probe.ts',
    },
  ],
  workers: 1,
  fullyParallel: false,
});
