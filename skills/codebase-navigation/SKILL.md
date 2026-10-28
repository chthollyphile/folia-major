---
name: codebase-navigation
description: Use when you need to locate code in this repository - unfamiliar areas, a feature described without a file path, or checking who uses something. Gives the three-layer order (generated code map, then rg, then the ts-code-map cli as fallback), says exactly when rg is not enough, and states the architectural boundaries that navigation must respect.
---

# Codebase Navigation

**先读 `docs/CODEMAP.md`，再用 rg，最后才用 cli。**

这份 skill 不维护路径表，`CODEMAP.md` 也不是人写的——它由 `npm run codemap` 从编译器和模块图
生成，main 落地后由 `codemap-sync` workflow 自动重生成并提交。本地想确认有没有偏差跑 `npm run codemap:check`；
PR 不校验它，不必手动同步。仓库的源文件和依赖太多，任何手写清单都覆盖不全且必然过期
（这里曾同时存在 7 处死引用，visualizer 模式清单也少了两个）。

skill 只负责地图和编译器都推不出来的东西：口头术语到名字的映射，以及架构约束的意图。

## 三层，按成本从低到高

**1. 结构性问题读 `docs/CODEMAP.md`。** 有哪些区域、入口在哪、哪些是枢纽模块、某个 registry
当前有哪些成员、哪里违反分层边界。零成本，且保证不过期。

**2. 符号级问题默认用 rg。** 快、灵活、能组合关键词，而且覆盖 `.md`/`.json`/CSS/shader 这些
LSP 根本看不到的地方。绝大多数「这个东西在哪」用 rg 就够了。

**3. rg 拿不准时才升级到 cli。** 它是后备，不是默认。

```
node dev/mcp/ts-code-map/cli.mjs <tool> '<JSON>'
node dev/mcp/ts-code-map/cli.mjs list      # 全部工具和用法
node dev/mcp/ts-code-map/cli.mjs doctor    # 环境自检
```

同一套能力也能作为 MCP server 挂载（`dev/mcp/ts-code-map/server.mjs`），但默认不加载：
工具 schema 每个会话常驻约 6KB，而绝大多数问题读地图加 rg 就解决了。

## 什么时候该从 rg 升级到 cli

| 情况 | 用 | 原因 |
| --- | --- | --- |
| 同名符号太多，分不清哪个是定义 | `references` | rg 区分不了声明、引用、字符串和注释；cli 会列出候选声明让你用 `file`/`line` 限定 |
| 要确认「所有用到的地方都改到了」 | `references` | rg 证明不了完备性；cli 给出语义引用 + 同名声明 + 仅文本命中三段，可信度分开标注 |
| 这个引用是读还是写 | `references` | rg 分不出，cli 用 documentHighlight 判定 |
| 谁调用了这个函数，往上追几层 | `callers` / `callees` | rg 做不到调用链 |
| 改这里会波及多大范围 | `impact` | 需要模块依赖图 |
| 想知道大文件里有什么，又不想读全文 | `file_outline` | 只输出提纲，比读全文省得多 |
| 要签名、类型、JSDoc | `inspect_symbol` | rg 只能看到文本 |

反过来，**这些情况 rg 更好，不要绕道 cli**：

- 已知确切的字面量、数字、字符串（`0.85`、某段报错文案）
- 在 `.md`、`.json`、CSS、shader 字符串里找东西
- 想看一个词的全部出现，包括注释和文档里的
- 只是想确认某个文件里有没有某段代码

## 一个已知陷阱

同一个概念常在多处各自声明（`lyricsFontScale` 在 store、OBS 配置类型、编解码、每个 visualizer
模式里各有一份，分布在几十个文件里）。这种情况下 rg 的结果看着乱，而 `references` 的第一个结果也
未必是你要的——它按分层角色猜（stores/types 优先于 components），只是启发式。**别拿第一个
结果当唯一答案**，看它列出的候选声明。

## Boundaries

定位到位置之后，改动要落在正确的地方：

- 新代码先按功能放：一个功能的文件放在它自己的一处（见 `skills/file-modularization/SKILL.md`）。
  旧代码多数还按种类分：UI 结构在 `components`；React 生命周期和副作用在 `hooks`；跨组件状态在
  `stores`；IO/缓存/provider 在 `services`；纯变换在 `utils`；契约在 `types`。改旧代码时照它所在的地方放。
- 依赖方向和“在线歌曲只走 omni”见 `AGENTS.md` 的“模块边界”，这里只补它们的理由和例子。
- `utils` 是叶子层，全仓都 import 它，所以它不能反过来读 store。需要读实时状态才能得出结果的
  「收集器」属于 `services` —— OBS 导出的 `visualSettingsConfig` / `currentObsUrl` / `obsCustomCss` /
  `webObsTarget` 因此在 `src/services/obs/`，而纯编解码的 `obsUrl` / `obsWebAppearance` / `appearanceCodec`
  留在 `utils`。
- Visualizer 消费已解析的 `LyricData` / `Line` / `Word`；格式解析留在 `src/utils/lyrics` 和 workers 里。
- Visualizer 模式由 registry 从各模式的 `entry.tsx` 自动发现，不在 `App.tsx` 里加 switch。
  背景同理，走 `backgrounds/` 下的 entry。
- entry 里的 renderer 必须包成 `React.lazy`：registry 用 eager glob 发现 entry，静态 import
  renderer 会让任何碰 visualizer 设置的模块连带拉进全部样式的 renderer 和 three.js。
- 只是校验「某字符串是不是合法模式」时用 `src/types/visualizerModes.ts` 的
  `isBuiltinVisualizerMode` / `isBuiltinVisualizerBackgroundMode`，不要 import registry。
  需要认 mod 投稿模式时才用 registry 的 `hasVisualizerMode`。模式清单由 registry 初始化时
  断言，漂移会抛错。
- 集合浏览（Library）在 `src/library/`：`core/`（headless，层由文件名说：`*.contract.ts` ← model ← `*.service.ts` /
  `use*Store.ts` ← 其余 `use*`，判断在 `dev/mcp/ts-code-map/libraryLayers.mjs`）、`suites/<id>/`（各套 UI，`entry.ts` 由
  `registry.ts` 发现）、`app/`（宿主装配）。core 不 import suites、app 和 `src/components`；suite 之间互不 import，不用 core 的
  `*.service.ts`，不读账户 store，登录一律 `openLoginWindow`。分工、每套 suite 的结构、bravais 的 stage / surface 分工和
  全部规则见 `docs/library-suites.md`（「四个角色」「规则」「现有 suite 的对照」几节），检查在 `BOUNDARY_RULES` 和
  `test/unit/library/layerBoundaries.test.ts`。
- `src/components/wall/` 是与内容无关的墙面引擎，Lattice 与 bravais 共用；它不依赖 `src/components/app/**` 与
  `src/library/**`（`test/unit/wall/wallBoundaries.test.ts`）。什么放进 wall、什么不放见 `docs/library-suites.md` 的「规则」。

## 这些名字已经不是当前入口

LSP 会老老实实找到死文件和历史命名，这几个需要人工标注：

- `LocalMusicView`、`local/LocalPlaylistView`、`navidrome/*`、旧的 `components/Home.tsx` —— 都已不存在，
  `test/unit/onlineMusic/omniArchitecture.test.ts` 确认它们不会回来。
  本地库和 Navidrome 的首页面现在是 `LocalGrid3DView` 和 `NavidromeGrid3DView`，首页入口在 `components/app/home/*`。
- `components/app/views/*`、`SearchResultsOverlay` —— 已不存在；搜索在 `SearchWorkspace`（`components/app/search/`）。
- `useSettingsUiStore` —— 已不存在，而且**不是简单改名**。设置弹窗的 UI 状态（当前 tab/子页）
  在 `useSettingsModalStore`；具体设置值被拆到了各领域 store（`useAudioSettingsStore`、
  `useLyricSettingsStore`、`useThemeSettingsStore`、`useTypographySettingsStore` 等）。
  想找某个设置项时按领域找，不要指望有一个统一的设置 store。
- `buildCommandPaletteContext` —— 现在是 `useCommandPaletteContext`（hook，不是 build 函数）。
- Lattice 里抽出去的墙面引擎：`components/app/lattice/` 下的 `layout` / `blockTemplates` / `blockReflows` /
  `wallNavigation` / `useWallCameraPan` / `useWallPointerPan` 现在在 `src/components/wall/`；`useLatticePosterArtwork` →
  `useWallPosterArtwork`，`LatticeTitle` → `WallTitle`；`LatticeFocusButton` 的按钮 / 面板外壳 → `WallToolsButton`（`LatticeFocusButton`
  只剩 Lattice 自己的条目），左上角返回 → `WallBackButton`，熄灯规则从 `Lattice.css` 搬进 `wall.css`。几何类型名（`QueueInstance`、`LatticeGeometry`、`LatticeCamera`）
  没改名。`useWallKeyboardFocus` 名字带 Wall，但和队列模型耦合，仍在 Lattice 目录。
- bravais 透光的「纱层」与「全屏遮罩底板」（`bravaisPlateMask`、`useBravaisPlate`、`useBravaisLivePlate`）都已删除，
  现在是按块的内联 SVG 底板：`BravaisBlockPlates`、`useBravaisBlockPlates`（纯函数 `bravaisBlockPlate`）、让位时的
  `useBravaisReflowPlate`。设计稿与交接记录里的「纱层」「遮罩」说的是旧写法。

发现文档里还有别的死路径，直接改掉，不要绕过去。

## 并行 worktree

同一个仓库常有几个并行的 worktree（`folia-*` 兄弟目录，各自一个分支）。定位时只看当前 worktree：rg、CODEMAP 和 cli
都按当前工作目录算，别把兄弟 worktree 里的同名文件当成当前代码。分支上的 `docs/CODEMAP.md` 只在 main 上由
workflow 自动重生成，分支里可能落后于代码，结构性问题拿不准时本地跑 `npm run codemap` 看一眼（`codemap:check` 报不一致
是预期的，只核对违规清单有没有新增）。并行 worktree 的 `node_modules` 若是指向主 worktree 的 junction，拆的时候只拆
junction，不要递归删除；各 worktree 共用 `node_modules/.vite` 的预构建缓存，Playwright 固定用 4173 端口且复用已有服务器，
同时跑两份要换端口。

## Validation

拿不准该怎么验证时看 `skills/testing-strategy/SKILL.md`。
纯文档改动时，路径和符号用 rg 核一遍即可。
