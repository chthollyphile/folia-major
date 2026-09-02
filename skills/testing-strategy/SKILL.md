---
name: testing-strategy
description: Use when the task involves choosing how to validate a change in this repository, deciding whether to inspect a running dev server, run unit tests, run Playwright UI screenshot tests, or avoid unnecessary builds.
---

# Testing Strategy

这个 skill 用于判断当前任务应该采用哪一种验证方式。

## Core Rule

如果当前用户终端已经在运行热加载开发服务器，例如 `vercel dev`、`vite`、`npm run dev`、`npm run dev:electron`，不要再额外运行构建来“测试”问题。

优先做这些事：

- 读取现有开发服务器报错
- 根据报错定位代码
- 只在确实需要额外验证时补充最小必要测试

## Validation Decision Tree

### 1. 前端页面样式、交互、回归截图

优先使用 Playwright UI 测试：

- 命令：`npm run test:ui`
- 更新基线：`npm run test:ui:update`

适用场景：

- 首页、播放器、面板、Navidrome、本地音乐等前端 UI 改动
- 需要截图对比
- 需要验证浏览器端 mock 数据表现

注意：

- 正式基线在 `test/ui/*.spec.ts-snapshots/`
- `test-results/` 是临时产物，不应提交

### 2. 纯逻辑、解析、状态管理、工具函数

优先使用 Vitest 单元测试：

- 命令：`npm run test:unit`
- 如需针对单文件或某类测试，优先用 Vitest 的路径过滤

适用场景：

- `src/utils/**`
- `src/stores/**`
- `src/hooks/**` 中不依赖真实浏览器渲染的逻辑
- 歌词解析、缓存逻辑、搜索状态、theme 状态等

同步与本地存储也按纯逻辑路径处理：

- `src/services/sync/**` 的 schema、fingerprint、Merkle bucket、主题注册表迁移和 coordinator 分支，优先看 `test/unit/sync/**`
- `src/services/themeCache.ts`、`src/services/db.ts` 的缓存边界，优先看 `test/unit/cache/**` 和相关 service 测试
- 同步测试应 mock 本地存储、IndexedDB adapter 或远端 client，不要连接真实的用户同步服务

### 3. 单个组件的浏览器级行为

有些问题只在真实浏览器里暴露，单测和整应用 UI 测试都盖不住：层叠与命中测试、
Tailwind 版本相关的类名语法、StrictMode 下 effect 双调用、异步 props 到达前的中间态。
这类情况写 Playwright component test，不要为此启动整个应用流程。

用的是 `@playwright/test` 内置的 `mount` fixture（1.62 起随包提供，不需要装
`@playwright/experimental-ct-react`）。`dev-probe.html` 同时是它要求的 gallery 页。

- 用例：`test/component/*.spec.ts`，从 `./fixtures` 取 `test` / `expect`
- 挂载：`const component = await mount('<探针 id>')`，返回的是 `#root` 的 Locator，
  查询尽量从它出发。参考 `test/component/trackTitleNavigator.spec.ts`
- 命令：`npm run test:component`
- 探针实现：`dev/probes/*.probe.tsx`，默认导出 `ProbeDefinition` 即自动注册；
  探针 id 直接就是 story id
- 人工调试：`npm run dev:probe`，`?probe=<id>` 挂单个组件，不带参数是索引页

探针页刻意开启 `React.StrictMode`，并使用真实 vite + 真实 Tailwind 产物；
它不加载首页数据、弹窗和背景 shader，所以比整应用测试快且稳定。
`dev-probe.html` 不在 `vite.config.ts` 的 `build.rollupOptions.input` 里，不会进生产产物。

新增探针时，探针内要复刻真实环境里的异步时序（例如切歌 props 晚几帧到达），
否则中间态 bug 复现不出来。

两条会绊人的：

- **`mount(id, props)` 的 props 要跨页面边界序列化。** `motionValue(42)`、React 组件、
  回调函数都过不去。复杂场景继续把 props 写死在探针里（现在全部如此），props 通道只用于
  标量参数的多场景复用。组件需要回调时，让探针自己持有状态、把结果记进一个隐藏表单，
  用例断言那个值。
- **改 localStorage 必须走 `page.addInitScript` 且排在 `fixtures` 的种子脚本之后。**
  `src/stores/*` 在模块 import 时就读 localStorage，挂载完再写已经晚了；种子脚本会先
  `localStorage.clear()`。同理，`page.reload()` 不会重新挂载 story（gallery URL 不带
  `?probe=`），要重挂就再 `mount()` 一次。

### 4. Electron / 打包 / release 流程

不要默认通过完整打包来验证。

优先顺序：

- 先读 workflow、脚本、日志
- 先做静态检查和最小范围验证
- 只有任务明确要求，或问题只会在打包阶段暴露时，才运行对应构建

涉及文件通常包括：

- `.github/workflows/*.yml`
- `electron/main.cjs` / `electron/updateChannels.cjs` (更新通道检查逻辑可通过 `test/unit/electron/updateChannels.test.ts` 跑单测)
- `package.json`

### 5. 开发服务器已经在跑

如果已有 dev server 在跑：

- 不要额外运行 `npm run build`
- 不要为了“确认一下”再启动第二个 dev server
- 优先读取现有终端错误和浏览器/运行时反馈

### 6. 仅改文档、issue template、配置说明

通常不需要运行测试。

只在以下情况补充验证：

- 改动影响脚本名、命令名、路径
- 改动和 workflow、测试配置、运行方式直接相关

如果文档只是补充当前模块边界、模式列表或设计说明，通常只需要静态核对路径和命令；只有当文档修正了同步 API、部署命令或测试入口时，才运行对应的最小单测或配置检查。

## Practical Guidance

- 小改动用最小验证，不要默认全量跑一遍。
- 如果用户只问原因分析，可以先分析，不强行跑测试。
- 如果测试依赖 mock，优先复用现有 Playwright/Vitest mock 入口，不要临时造第二套机制。
- 如果构建命令和运行中的热加载服务冲突，优先保留热加载上下文。

## Repository-Specific Commands

- `npm run test:unit`
- `npm run test:ui`（e2e + components 两个 project）
- `npm run test:component`
- `npm run test:ui:update`
- `npm run dev:probe`

同步/主题文档涉及协议或持久化边界时，可优先选择：

- `npm run test:unit -- test/unit/sync/themeSyncRegistry.test.ts`
- `npm run test:unit -- test/unit/cache/themeCache.test.ts`

## What To Avoid

- 在已有热加载服务运行时，再跑 build 验证前端问题
- 为了一个 UI 小改动去跑 Electron 全量打包
- 把 `test-results/` 之类的临时产物提交进仓库
