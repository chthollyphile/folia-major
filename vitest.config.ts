import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';
import { commandPinyinPlugin } from './dev/pinyin/commandPinyinPlugin.mjs';
import { traditionalLocalePlugin } from './dev/i18n/traditionalLocalePlugin.mjs';
import { icuFoliaDataPlugin } from './dev/icuFolia/icuFoliaDataPlugin.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // 命令面板的检索索引在单测里也要读到构建期生成的拼音字典。
  // 繁中 locale 由 zh-CN 在构建期转换生成，同样只以虚拟模块存在。
  // icu-folia 的 jieba 词典和 HMM 表同样以虚拟模块提供，单测走的是和正式构建同一条加载路径。
  plugins: [commandPinyinPlugin(), traditionalLocalePlugin(), icuFoliaDataPlugin()],
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
    include: ['test/unit/**/*.test.ts', 'packages/*/test/**/*.test.mjs'],
    // Node 25 起自带的 localStorage 占位会盖住 jsdom 的那份：jsdom 用例在这里统一补内存实现，node 用例删掉占位。
    setupFiles: ['test/unit/jsdomLocalStorage.ts']
  }
});
