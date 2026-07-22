---
name: reuse-project-utilities
description: Use when implementing, refactoring, or reviewing code in this repository and the task may duplicate existing helpers, libraries, visualizer utilities, lyrics utilities, font/color helpers, list virtualization, icon usage, i18n, playback adapters, or service patterns. Trigger before writing new utility functions or installing/hand-rolling functionality already present in the project.
---

# Reuse Project Utilities

## Purpose

这个 skill 用于防止“造一个颜色不同的轮子”。写代码前先查已有 helper、组件模式和项目已安装库，优先复用它们。

核心规则：

- 新增工具函数前，先用 `rg` 搜相同领域的现有函数。
- 外部库已经覆盖的能力，不要手写低配版。
- 复用项目里已经承载语义的 helper，而不是复制局部实现。
- 如果已有 helper 不够，优先扩展原 helper 并补测试，而不是另起相似名字。

## Fast Lookup

按任务类型先查这些入口：

- 歌词解析、时序、render end：`src/utils/lyrics/*`
- visualizer 运行时、背景、颜色：`src/components/visualizer/*`
- 设置 UI、导入导出、命令面板：`src/components/modal/settings/*`、`src/stores/useSettingsUiStore.ts`、`src/components/command-palette/*`
- 同步配置、主题同步和本地导出：`src/services/sync/*`、`src/components/modal/settings/StorageSettingsSection.tsx`
- 字体栈和自定义字体：`src/utils/fontStacks.ts`、`src/services/customLyricsFont.ts`
- 播放队列、播放适配：`src/services/playbackAdapters.ts`、`src/utils/appPlaybackHelpers.ts`
- 网易云 / Navidrome / 本地音乐 API：`src/services/*`
- 主题、封面、取色、缓存：`src/hooks/themeControllerState.ts`、`src/utils/colorExtractor.ts`、`src/services/themeCache.ts`、`src/services/coverCache.ts`
- UI 图标、动画、弹窗、选择器：`lucide-react`、`framer-motion`、`components/shared/*`

推荐搜索：

```bash
rg -n "目标词|函数名|相邻概念" src test
rg -n "prepareWithSegments|layoutWithLines|useVisualizerRuntime|getLineRenderEndTime|buildLineGraphemeTimeline|resolveThemeFontStack|colorWithAlpha|mixColors" src
```

## Common Utilities

### Text Layout And Measurement

已安装 `@chenglou/pretext`，用于文字准备、测量和排版。

优先用：

```ts
import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext';

const prepared = prepareWithSegments(text, fontSpec);
const layout = layoutWithLines(prepared, maxWidth, lineHeightPx);
const width = layout.lines[0]?.width ?? fallbackWidth;
```

适用场景：

- visualizer 文本宽度测量
- 歌词自动换行
- 气泡、块状文本、canvas overlay 的排版
- 需要和 CJK / grapheme 排版更接近真实浏览器表现的场景

不要手写 `text.length * fontSize` 作为主测量逻辑；只能作为 fallback。

### Visualizer Runtime

visualizer 当前行、上一行、下一行、预热窗口已有共享入口：

- `useVisualizerRuntime`
- `prepareActiveAndUpcoming`
- `shouldPreheatLine`
- `getUpcomingLine`
- `getUpcomingLines`

位置：`src/components/visualizer/runtime.ts`

新增 visualizer 时优先使用它们，不要重新写“当前行/下一行/最近完成行”扫描逻辑。

### Lyrics Timing Hints

歌词行显示结束时间和过短行处理已有统一 helper：

- `getLineRenderHints`
- `getLineRenderEndTime`
- `getLineTransitionTiming`
- `ensureLyricLinesRenderHints`

位置：`src/utils/lyrics/renderHints.ts`

需要决定 line exit、subtitle 保留、短行 fast/instant reveal 时，先用这些 helper。不要直接假设 `line.endTime` 就是视觉渲染结束时间。

写 visualizer 时同时遵守 `frontend-runtime-guardrails` 里的歌词输入契约：renderer 消费统一 `LyricData`，不要重新处理原始歌词格式或翻译对齐。

### Lyrics Layout Units

CJK 语义分组、sticky 标点、英文 contraction 已有布局工具：

- `buildPostLyricLayoutUnits`
- `buildDisplayWordsFromLayoutUnits`
- `createSingleWordLayoutUnits`

位置：`src/utils/lyrics/cjkSemanticLayout.ts`

新增按词/按块 visualizer 时，优先使用 layout units。不要在组件里临时拼接标点、撇号、CJK 字符。

### Grapheme Timing

逐字或逐 grapheme 动画优先复用 `src/utils/lyrics/graphemeTiming.ts`：

- `buildLineGraphemeTimeline`
- `buildWordGraphemeTimings`

它们负责把 `Line.words` 的原始 timing 映射到可渲染字符；不要在 renderer 里用字符串搜索重新猜重复词、空格或标点的时间范围。

### Font Stacks

主题字体和自定义字体已有 resolver：

- `resolveThemeFontStack`
- `resolveThemeTranslationFontStack`
- `getBuiltinThemeFontStack`
- `resolveThemeFontWeight`
- `normalizeFontWeight`

位置：`src/utils/fontStacks.ts`

需要 CSS `fontFamily`、canvas `font`、pretext `fontSpec` 时，先用 resolver。不要手写一份新的 fallback font stack。

歌词和字幕的最终字重必须使用 `resolveThemeFontWeight(theme, modeFallback)`。模式自身的 300、400、500、700 等设计值只能作为 `modeFallback`：`theme.fontWeight` 有值时必须由用户值覆盖，没有值时才保留模式原设计。当用户在设置面板或快捷设置中清空/重置自定义字体栈时，系统会自动清空保存的自定义字重。DOM、Canvas、pretext 和光栅化文本必须复用同一个解析结果；测量规格、memo 依赖和布局缓存键也必须包含该最终字重。

不要在歌词或字幕渲染路径中使用 `font-bold`、`font-medium`、固定 `style.fontWeight`，也不要把固定字重直接写进 Canvas / pretext 字体规格。这些写法会绕开视觉设置，并造成测量与渲染不一致。

### Visualizer Colors

visualizer 颜色混合和 alpha 已有 helper：

- `colorWithAlpha(color, alpha)`
- `mixColors(from, to, amount, alpha?)`

位置：`src/components/visualizer/colorMix.ts`

需要 `rgba(...)`、主题色混合、canvas gradient、shadow color 时，先用这些 helper。不要重复写 hex/rgb parser。

组件颜色必须来自当前 `Theme` / `DualTheme` 流程。新增 UI 或 visualizer 颜色时，不要把只适合单一明暗背景的固定 hex / rgba 当成主色长期写死；应从 `theme.backgroundColor`、`theme.primaryColor`、`theme.accentColor`、`theme.secondaryColor` 或由 `buildBuiltinDualTheme` / `useThemeController` 选出的当前明暗主题动态派生，并确保 light / dark 两套颜色都有可读对比。临时 alpha、shadow 和 gradient 也应基于主题色再用 `colorWithAlpha` / `mixColors` 生成。

### Icons

项目使用 `lucide-react`。按钮、tab、控制项、状态动作优先从 lucide 导入图标。

不要手写 SVG，除非现有 icon 库没有合适图标或需要项目专属图形。

### Animation

项目使用 `framer-motion`：

- 普通 enter/exit：`motion`、`AnimatePresence`
- 播放进度和时间值：`MotionValue`、`useMotionValueEvent`
- 派生动画值：`useTransform`、`useSpring`

新增动画先看相邻组件模式。涉及高频运行时，再结合 `frontend-runtime-guardrails`。

### i18n

UI 文案使用 `react-i18next`：

```ts
const { t } = useTranslation();
```

任何新增到 UI 上的用户可见文本都必须准备 i18n key，并同步写入 `src/i18n/locales/en.ts` 和 `src/i18n/locales/zh-CN.ts`。不要把按钮、标题、提示、空态、设置项、tooltip、toast 或模式文案只写成硬编码字符串；短 fallback 只能作为现有 registry / 兼容模式的兜底，不能替代字典项。

### Settings And Commands

新增设置时先套用 `settings-feature-integration`：

- 视觉相关设置必须进入 `AppearanceSettingsSubview.tsx` 的导入导出链路。
- 功能性设置或可执行动作必须注册到 `src/components/command-palette/commandRegistry.ts`。
- 设置状态优先复用 `src/stores/useSettingsUiStore.ts`，不要在组件里另起一套 localStorage 读写。

### Long Lists

项目已使用 `react-window` 的 `List` 和 `useListRef`。

需要渲染队列、字体列表、大量歌曲列表时，先查现有 `react-window` 用法。不要用普通 `.map()` 渲染大量可滚动项目。

## Service And Data Patterns

不要绕过现有 service：

- 网易云 API：`src/services/netease.ts`
- Navidrome / Subsonic：`src/services/navidromeService.ts`
- 本地音乐：`src/services/localMusicService.ts`
- 在线歌曲搜索、播放、歌词、歌单、账户和 provider 路由：`src/services/onlineMusic/omni.ts`
- 在线播放编排：`src/services/onlinePlayback.ts`（内部在线数据仍须通过 Omni）
- 播放结构统一：`src/services/playbackAdapters.ts`
- IndexedDB：`src/services/db.ts`
- 队列预取：`src/services/prefetchService.ts`
- 同步 HTTP / diff / 本地 registry：`src/services/sync/syncClient.ts`、`syncRepository.ts`、`themeSyncRegistry.ts`、`syncCoordinator.ts`

新增数据流时，先判断是 service、hook、util 还是 component：

- 请求、缓存、接口适配放 service。
- React 生命周期和用户动作编排放 hook 或 app-level builder。
- 纯计算、映射、格式化放 util。
- 展示和交互结构放 component。

## Extension Rule

如果找到已有 helper 但不完全够用：

- 优先扩展已有 helper 的参数或返回值。
- 保持现有调用兼容。
- 给扩展后的 helper 补单测。
- 避免创建同领域的第二套 `formatXxx`、`parseXxx`、`measureXxx`、`mixXxx`。

只有在职责确实不同、现有 helper 会变得混乱时，才新建工具。

## Review Checklist

审查代码时检查：

- 是否手写了已由 `@chenglou/pretext`、`fontStacks`、`colorMix`、lyrics utils 覆盖的逻辑？
- 是否复制了 visualizer runtime 的当前行/下一行扫描？
- 是否直接使用 `line.endTime`，但应该使用 `getLineRenderEndTime`？
- 是否手写 SVG，而 lucide 已有图标？
- 是否新建了 service 请求逻辑，但已有 service 已经封装同类 API？
- 是否绕过 `src/services/sync/*`，直接对同步服务发 fetch，或直接读写主题同步 registry / IndexedDB？
- 是否对大量列表使用普通 `.map()` 而不是虚拟列表？
- 是否新增硬编码文案却没有更新 i18n 字典？
- 是否新增设置却没有接入视觉配置导入导出或 command palette？
- 是否新增固定颜色却没有从 `Theme` / `DualTheme` 动态派生并检查明暗两套表现？
- 是否硬编码歌词或字幕字重，而没有使用 `resolveThemeFontWeight` 和模式 fallback？
- DOM、Canvas、pretext、光栅化的最终字重以及布局缓存键是否一致？
- 是否创建了相似 helper，却没有搜索已有实现或测试？

## Validation

- 纯工具、歌词、颜色、字体：优先补或跑相关 Vitest 单测。
- visualizer UI：按 `testing-strategy` 判断是否需要 UI 截图测试。
- service 改动：优先看现有 service 单测或相邻 mock 模式；不要直接打真实外部服务。
