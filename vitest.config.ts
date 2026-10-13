import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';
import { commandPinyinPlugin } from './dev/pinyin/commandPinyinPlugin.mjs';
import { icuFoliaDataPlugin } from './dev/icuFolia/icuFoliaDataPlugin.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // 命令面板的检索索引在单测里也要读到构建期生成的拼音字典。
  // icu-folia 的 jieba 词典和 HMM 表同样以虚拟模块提供，单测走的是和正式构建同一条加载路径。
  plugins: [commandPinyinPlugin(), icuFoliaDataPlugin()],
  // 单测默认按官方构建跑（vite.config 构建期注入的值）；非官方分支由各自的用例显式传入构建环境。
  define: {
    __BUILD_KIND__: JSON.stringify('official'),
    __BUILD_HOST__: JSON.stringify(''),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  test: {
    environment: 'node',
    // 第二消费者始终参与单测；test.env 与 vi.stubEnv 使用同一入口，可覆写验证关闭/生产边界。
    // 初始选择钉在 grid：现有用例都假设没选过 suite 的人看到网格（开发阶段的初始选择是 bravais）。
    env: { VITE_LIBRARY_TUI: 'true', VITE_LIBRARY_INITIAL_SUITE: 'grid' },
    include: ['test/unit/**/*.test.ts'],
    // 默认 5s 对不上这个仓库里几个文件的真实成本，并发跑时被 CPU 争抢放大后就会
    // 偶发 timeout（单跑必过、全量随机失败，是很典型的 flaky 特征）：
    //   - 每个用例 resetModules() + 动态 import 的（themeSyncRegistry、storeContract），
    //     一次重建整棵模块图实测约 850ms，几个用例叠起来在并发下能到 4s 以上；
    //   - 遍历整棵源码树的（modDigest / modSignature）本身就要扫几千个文件。
    // 这些 reset 和遍历都是语义必需的，删不掉，所以按真实成本给超时而不是硬扛默认值。
    testTimeout: 30000,
    hookTimeout: 30000,
  }
});
