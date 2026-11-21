import { installLxRuntime } from './runtime.ts';

// sources/lxmusic/main/sandbox/entry.ts
// 沙箱页面的入口（package.json 的 folia.workers.sandbox，构建成模组文件夹里的 sandbox.cjs）。它不是工作线程：
// main 入口把这个文件读成文本，经 executeJavaScript 注入隐藏沙箱窗口（sandboxHost.ts），所以这里和它引的
// 文件都不能用 Node 的东西。

(globalThis as Record<string, unknown>).__lxHost = installLxRuntime(globalThis);
