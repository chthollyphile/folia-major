---
name: file-modularization
description: Use when adding a feature or a file, moving or renaming files, or refactoring in this repository. Decides where new code goes (a feature's code kept together in one place of its own, flat until the folder is hard to scan), what must not be moved because a tool finds it by path, how a move is committed, and the size limits that keep entry files, page roots and App.tsx from growing.
---

# 一个功能的代码放在一起

先按功能分，再按代码种类（界面、状态、数据读取、纯计算、类型）分。一个功能的文件放进这个功能自己的一处；功能之外只留几个接入点（注册的一行、装配的一两行）。

检查方法：删掉那一处和那几个接入点，功能就删干净了，别处不留没用的代码。

## 适用范围

- 新加的代码，和正在统一、解耦的模块：账号、平台接入、登录、播放、歌词显示、歌词动画样式、设置、弹窗、mod。在这个范围里，按本规则放是默认；不这样放要在提交说明或文件头写明原因。
- 没人在动的旧代码留在原处。挪它要先写计划（挪哪些文件、挪到哪、为什么、哪些按路径找它的地方要跟着改），等维护者同意再挪。
- 旧规则“新文件按种类放进 `src/hooks`、`src/utils`”不再是把新代码按种类分开放的理由。`src/hooks`、`src/utils`、`src/services` 仍是两个以上功能共用的东西的去处。

## 怎么放

- **先平铺。** 一个目录难以一眼看完（大约 15 个文件以上）才加子目录。不预先建空目录。
- **代码跟着它服务的东西走。** 只服务一个变体（一个平台、一种后端、一种设备）的代码放在那个变体那里。两个功能都用到了，才挪到共用的地方。
- **服务层不能 import 界面层。** 代码地图按路径检查依赖方向（`dev/mcp/ts-code-map/codemap.mjs` 的 `BOUNDARY_RULES`）：`src/services`、`src/stores`、`src/utils`、`src/types` 下的文件不能在运行时 import `src/components` 下的文件。所以一个功能的数据部分要给服务层用时，这个功能可以分两处：数据一半在 `src/services/...`，界面一半在 `src/components/...`。在两边的文件头写明这个选择和原因。
- **类型。** 只属于一个功能的类型放在功能目录里；多个功能共用的契约（例如在线平台的 `src/types/onlineMusic.ts`）放 `src/types.ts` / `src/types/*`。
- **测试跟着功能走。** `vitest.config.ts` 收 `test/unit/**/*.test.ts`，放在 `test/unit/<功能>/` 下照样会跑。

现有的例子：

- 一个平台：`src/services/onlineMusic/ytm/`、`electron/ytm/`、`test/unit/ytm/`（Spotify 同样）。目录名就是平台 id：`test/unit/onlineMusic/platformNameCount.ts` 按这个名字认平台自己的文件。
- 登录：界面和 hook 在 `src/components/login/`，不认识平台的失败分类和请求时限在 `src/services/onlineMusic/login/`（两处，因为 transport 要用请求时限）。
- 探索页：`src/components/app/home/explore/`，包括它自己的播放记录和动效。
- 一个歌词动画样式：`src/components/visualizer/<mode>/`（`entry.tsx`、`tuning.ts`、设置面板、渲染器）。

## 不能挪的

语言或工具按路径找到的东西，留在被找到的地方。挪文件之前先 rg 一遍这些：

- 测试的收集范围：`vitest.config.ts` 的 `include`，`playwright.config.ts` 各 project 的 `testDir`。
- `import.meta.glob` 找的文件：歌词样式 `src/components/visualizer/<mode>/entry.tsx` 和 `<mode>/tuning.ts`，背景 `backgrounds/<name>/entry.tsx`、`tuning.ts`、`settings.ts`，开发探针 `dev/probes/*.probe.tsx`，登录方式图标 `src/assets/providers/*.svg`，ponder 的 `src/components/ponder/targets/**/*.target.ts` 和 `surfaces/**/*.surface.tsx`。
- 检查脚本扫描的目录和文件：例如 `test/unit/onlineMusic/platformNamePlaces.ts` 按路径登记文件。
- 代码地图生成器 `dev/mcp/ts-code-map/codemap.mjs`：区域和依赖方向都按路径判断。

挪完以后 rg 一遍旧路径（文档、配置、测试），一起改掉。

## 怎么挪

- 挪已有的文件，先有维护者同意过的计划（见“适用范围”）。
- 挪文件是单独一个提交，只挪不改内容。这样 git 的历史和合并能跟上挪动。
- 内容的修改放在后面的提交里。

## 大小警戒值

这些是默认警戒值，不是要求机械重写历史文件：

- `src/index.tsx`、新页面根组件、全局 provider 装配文件：尽量不超过 180 行。
- 普通容器、页面组件、复杂 hook：尽量不超过 220 行。
- 展示组件、工具、适配器：尽量不超过 160 行。
- 单次需求若要向现有文件追加超过 80 行，先判断是否应新建模块。
- `src/App.tsx` 已经远超入口阈值；触碰相关区域时优先抽到相邻的功能目录，不要以“就近”为由继续扩大。

## 入口文件只装配

`App.tsx` 是历史遗留的全局装配点，已经很大；新功能不要继续堆进它。页面根组件只保留传参、组合和必要分支，实现放在相邻文件：

- `src/components/app/Home.tsx` -> `components/app/home/*`（`buildHomeModel.ts`、collection adapters）与 `src/library/`（集合宿主 `app/GridViewOverlayHost.tsx`、网格 suite `suites/grid/*` 里本地和 Navidrome 的网格视图）。
- `src/components/app/PlayerPanel.tsx` -> `components/app/player-panel/*`。
- `src/components/app/overlays/AppOverlays.tsx` -> `components/app/overlays/*`。
- `src/components/app/dialogs/AppDialogs.tsx` -> `components/app/dialogs/*`。
- 播放恢复、在线回退、缓存 -> `components/app/playback/*`。
- 搜索工作台和搜索动作 -> `components/app/search/*`。
- 主进程：一个平台的桥放在 `electron/<id>/`，更新通道在 `electron/updateChannels.cjs`；不要把新的 Electron 逻辑都塞回 `electron/main.cjs`，那里只留创建和接线。

## 拆分信号

- 一个文件同时新增界面、请求、副作用、状态派生、事件处理和类型定义：拆分不足。
- JSX 跨越多个主要视觉区域：拆组件。
- 同类 state/effect 成组且与界面弱相关：拆 hook，放在功能自己的目录里。
- 只服务一个页面的无生命周期组装：拆成相邻的 `build*.ts` / `create*.ts`。
- 包含请求、解析、适配、排序、缓存或序列化：拆成功能目录里的单独文件；两个功能都用到才放进共用的 `services` / `utils`。
- 需要独立测试，或让当前文件多一种职责：不要留在原文件。

## 要避免的

- 在 `App.tsx` 中直接新增完整功能区、请求函数或大段事件处理。
- 在页面组件中混合 provider 请求、缓存、排序工具和类型声明。
- 把一个功能的文件按种类撒到 `src/hooks`、`src/utils`、`src/types` 各处，删功能时要到处找。
- 把新首页、GridView、集合详情功能塞回已经删掉的旧页面（见 `codebase-navigation` 的旧名字一节）；当前入口在 `components/app/home/*` 与 `src/library/`（`suites/grid`、`app`）。
- 通过“拆成很多空壳文件”伪装模块化；拆分后职责和依赖方向必须更清楚。
- 为了省一次 import，继续向已有超大的 visualizer、`VisPlayground` 或 `SettingsModal` 追加大段实现。

## 检查清单

- [ ] 新代码是不是都在这个功能自己的一处？那一处之外只有接入点吗？
- [ ] 不按功能放的文件，写明原因了吗？
- [ ] 加子目录之前，目录真的难以一眼看完了吗？
- [ ] 挪过的文件：有维护者同意过的计划吗？挪动是不是单独的提交？按路径找它的工具、测试和文档都改了吗？
- [ ] 是否复用了现有的 builder、hook、service、utils 和共享类型？
- [ ] 是否避免扩大 `App.tsx`、`SettingsModal.tsx`、`VisPlayground.tsx` 或单个 visualizer 文件？
