import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';
import { commandPinyinPlugin } from './dev/pinyin/commandPinyinPlugin.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // 命令面板的检索索引在单测里也要读到构建期生成的拼音字典。
  plugins: [commandPinyinPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  test: {
    environment: 'node',
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
