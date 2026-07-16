# Visualizer 开发说明

这个目录放的是播放页歌词可视化相关组件。

当前已有实现：

- `classic/Visualizer.tsx`: 经典流光模式
- `cadenza/VisualizerCadenza.tsx`: 心象模式
- `partita/VisualizerPartita.tsx`: 云阶模式
- `fume/VisualizerFume.tsx`: 浮名模式
- `cappella/VisualizerCappella.tsx`: 群唱模式
- `tilt/VisualizerTilt.tsx`: 倾诉模式
- `claddagh/VisualizerCladdagh.tsx`: 回环模式
- `monet/VisualizerMonet.tsx`: 莫奈海报模式
- `definition.ts`: visualizer 共享契约、registry entry 定义
- `settingsPanels.tsx`: 模式自带设置面板
- `VisualizerShell.tsx`: 共享外层容器、背景层、返回按钮
- `VisualizerSubtitleOverlay.tsx`: 共享底部翻译 / 下一句提示层
- `runtime.ts`: 共享 runtime 工具与基础 hook（当前行、下一句、最近完成句、预热入口）
- `FumeBackground.ts`: Fume 专用 canvas 几何背景
- `backgrounds/<mode>/`: shell 级背景模式目录，包含 `entry.tsx`、渲染层和可选设置卡
- `backgrounds/registry.tsx`: 自动发现 `backgrounds/*/entry.tsx`
- `backgrounds/definition.ts`: 背景统一配置、动作和注册入口契约
- `VisPlayground.tsx`: 可视化预览和样式设置面板
- `VisPlaygroundSettingsPanel.tsx`: 预览页的共享设置控制面板

## 歌词，配色，Visualizer

Visualizer 接收的是歌词流水线已经整理好的 `Line[]`，不应该在 renderer 内重新解析 LRC、TTML、YRC 等原始格式。对大多数模式，推荐把歌词处理拆成“行切换”和“行内动画”两层：用 React state 追踪 `currentLineIndex` 的离散变化，从而触发上一行退场、当前行入场和下一行预热；行内连续进度则交给 `currentTime`、Framer Motion、CSS 或 canvas，不要把精确播放时间或每个字符的进度逐帧写入 state。

行内动画优先按字符（更准确地说是 grapheme）组织。整行需要逐字符时间轴时使用 `src/utils/lyrics/graphemeTiming.ts` 的 `buildLineGraphemeTimeline(line)`；已经按 `Word` 排版时使用 `buildWordGraphemeTimings(word, wordIndex)`。这两个工具会从解析器提供的词、音节 timing 构建可渲染字符 timing，并处理 CJK、组合字符、空格、标点和重复文本的映射。Visualizer 只负责根据这些 timing 设计 reveal、pass、trail 等动画曲线，不要再按字符串长度平均猜测时间。

歌词的基础颜色必须来自当前 `theme`：正文通常使用 `theme.primaryColor`，激活态和高光通常使用 `theme.accentColor`，弱化信息可使用 `theme.secondaryColor`。需要透明度或混色时复用 `colorWithAlpha`、`mixColors`。关键词着色使用 `src/components/visualizer/wordColoring.ts`：按词渲染可调用 `resolveWordColor(word.text, theme.wordColors, theme.accentColor)`；按字符或自定义 token 渲染时，先用 `prepareWordColorMatchers` 和 `buildWordColorRangesFromMatchers` 建立范围，再用 `resolveTokenColorMap` 映射颜色。这样可以统一处理中英文关键词、短语重叠和 fallback，不要在各模式中重复实现匹配规则或写死颜色。

`Line.isChorus` 表示副歌行。新 visualizer 应为副歌准备独立于普通行的强化表现，例如更强的 glow、不同的排版、额外粒子或音频响应。副歌特效只改变视觉表现，仍应沿用同一套行索引和字符 timing；当 `isChorus` 或 `chorusEffect` 缺失时必须自然回退到普通行效果。

TTML 歌词可以选择性支持更高级的表现。当前统一数据中可能包含音节 timing、ruby、逐行翻译或罗马音、`backgroundVocal`、`agentId` / `ttml.agents`、`songPart`、`blockIndex` 等信息，适合实现注音、伴唱、多歌手分轨或段落级布局。但这些是增量能力，不是 TTML 文件的稳定必备字段，目前也不是 visualizer 的主要依赖。实现时必须逐项检查字段是否存在，并始终保留只依赖 `Line.fullText`、`Line.words` 和基础 timing 的标准渲染路径，不能假设每一份 TTML 都带有相同的高级特性。

## 目标

实现一个新的 visualizer 时，需要保证它可以同时在下面两个场景里工作：

1. 播放页实际渲染，由 `src/App.tsx` 调用
2. 预览面板渲染，由 `VisPlayground.tsx` 调用

这意味着新组件不能只“能显示”，还要遵守现有调用约定。

## 必须遵守的组件契约

当前目录下的 visualizer 已经统一收敛到 `definition.ts` 的共享接口。新实现建议直接兼容 `VisualizerSharedProps`。

```tsx
interface VisualizerSharedProps {
    currentTime: MotionValue<number>;
    currentLineIndex: number;
    lines: Line[];
    theme: Theme;
    subtitleTheme?: Theme;
    isDaylight?: boolean;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    showText?: boolean;
    songTitle?: string | null;
    songArtist?: string | null;
    songAlbum?: string | null;
    coverUrl?: string | null;
    seed?: string | number;
    staticMode?: boolean;
    visualizerOpacity?: number;
    background?: VisualizerBackgroundConfig;
    lyricsFontScale?: number;
    subtitleOverlayOpacity?: number;
    isPlayerChromeHidden?: boolean;
    hideTranslationSubtitle?: boolean;
    showSubtitleTranslation?: boolean;
    paused?: boolean;
    isPreviewMode?: boolean;
    onBack?: () => void;
    onLyricLineSeek?: (lyricTimeSec: number) => void;
    classicTuning?: ClassicTuning;
    cadenzaTuning?: CadenzaTuning;
    partitaTuning?: PartitaTuning;
    fumeTuning?: FumeTuning;
    claddaghTuning?: CladdaghTuning;
    onCladdaghTuningChange?: (patch: Partial<CladdaghTuning>) => void;
    cappellaTuning?: CappellaTuning;
    cappellaCustomEmojiImages?: CappellaEmojiImage[];
    cappellaCustomAvatarImages?: CappellaAvatarImage[];
    tiltTuning?: TiltTuning;
    monetTuning?: MonetTuning;
    monetPortraitImage?: MonetPortraitImage | null;
    onMonetTuningChange?: (patch: Partial<MonetTuning>) => void;
}
```

组件导出形式也保持一致：

```tsx
const VisualizerFoo: React.FC<VisualizerSharedProps> = (props) => {
    // ...
};

export default VisualizerFoo;
```

如果你的 visualizer 需要独有调参，也沿用现有模式，增加可选 props，例如：

- `cadenzaTuning?: CadenzaTuning`
- `partitaTuning?: PartitaTuning`
- `fumeTuning?: FumeTuning`
- `claddaghTuning?: CladdaghTuning`
- `cappellaTuning?: CappellaTuning`
- `tiltTuning?: TiltTuning`
- `monetTuning?: MonetTuning`

不要把必须由外部传入的运行时配置写死在组件常量里，除非它确实不需要进入设置面板。

## 每个 props 的职责

### 核心时间与歌词数据

- `currentTime`: 当前播放时间的 `MotionValue<number>`，单位秒。推荐通过 `currentTime.get()` 读取当前值，或通过 `useMotionValueEvent` 监听变化。
  禁止把它的连续变化写入 `useState`、store 或 reducer 来追踪当前精确时间；播放器中的逐帧动画应继续使用 MotionValue、`useTransform`、CSS / Framer Motion、canvas draw loop 或 `useRef` 保存瞬时值。React state 只用于当前行、可见段落、waiting / active / passed 等离散变化。
- `currentLineIndex`: 当前激活歌词行索引。可能为 `-1`，表示当前没有激活行。
- `lines`: 已处理好的歌词行数组。新 visualizer 应假定这里的数据已经可直接渲染，不再负责拉取或解析歌词。

### 主题与音频输入

- `theme`: 当前歌词主题。包含颜色、字体风格、动画强度等。
  新增颜色必须从当前 `Theme` / `DualTheme` 的 light / dark 结果动态派生，优先使用 `backgroundColor`、`primaryColor`、`accentColor`、`secondaryColor` 及 `colorMix.ts` 工具；不要长期写死只适配暗色或亮色的固定 hex / rgba。
- `isDaylight`: 当前是否是浅色主题，适合细调边框、阴影和控制面板对比度。
- `audioPower`: 音频整体能量。
- `audioBands`: 分频能量，用于驱动背景或局部动画。
- `subtitleTheme`: 可选的字幕专用主题；未提供时共享字幕层会回退到当前 `theme`。

### 展示控制

- `showText`: 是否显示歌词文字。预览和播放器里都可能传入。
- `songTitle`: 当前歌曲标题，主要给会把整首歌词重组成新表现形式的模式使用，例如 `cappella`。
- `songArtist` / `songAlbum`: 当前歌曲元数据，适合海报式或唱片式 visualizer 使用。
- `coverUrl`: 封面 URL，由当前 background entry 按需使用。
- `background`: shell 背景统一配置。模式、透明背景、通用背景参数、共享自定义图片以及 Monet / Nomand / URL 专属配置都在这里传递。
- `visualizerOpacity`: 歌词动画整体透明度，不应该由每个 renderer 再各自发明一套全局透明度。
- `lyricsFontScale`: 用户字号缩放。新 visualizer 应把它乘进最终字号，而不是忽略。
- `subtitleOverlayOpacity`: 共享字幕层透明度。
- `subtitleOverlayBackground`: 是否为共享字幕层添加主题自适应的半透明背景。
- `staticMode`: 静态模式。约定为“禁用重资源背景动画”，不是关闭全部歌词动画。
- `isPlayerChromeHidden`: 播放器外层 chrome 是否隐藏，适合做边距或字幕策略调整。
- `hideTranslationSubtitle`: 关闭整个底部 subtitle overlay 时使用，包括翻译和下一句提示；这是旧设置的前向兼容语义。
- `showSubtitleTranslation`: 控制翻译文本是否显示，默认 `true`。新 visualizer 中涉及翻译字幕时优先接入这个参数。
- `paused`: 当前是否暂停，适合暂停持续性动效。
- `onBack`: 返回按钮回调。播放器全屏/主视图里会用到。
- `onLyricLineSeek`: 可选的歌词行点击跳转回调；需要让 visualizer 参与时间轴交互时使用，不要在 renderer 里直接操作 audio 元素。
- `seed`: 背景或布局随机种子，保证同一歌曲下布局尽量稳定。
- `isPreviewMode`: 当前是否处于 `VisPlayground` / `ThemePark` 预览模式。
- `claddaghTuning` / `onCladdaghTuningChange`: 回环模式的主歌词放大、轨道半径、椭圆倾角、轴线和字符间距参数。

## 新 visualizer 至少应该处理的场景

### 1. 无激活歌词行

当 `currentLineIndex === -1` 或 `activeLine` 不存在时，组件不能报错，应该显示空态，例如：

- `waiting for music`
- 上一行翻译
- 或仅保留背景

### 2. `showText === false`

播放器可能要求只显示背景、不显示歌词。组件应在该模式下仍能正常渲染背景层，不要把整棵组件树直接短路到 `null`。

### 3. `staticMode === true`

应禁用或降级重资源背景效果。当前实现通常保留：

- 底色层
- 流体背景层
- 歌词本身

并关闭：

- `GeometricBackground`

### 4. `onBack` 可选

只有在传入 `onBack` 时才显示返回按钮。

## 排查建议

当 visualizer 出现“切句太早 / 太晚”“逐字动画没走完”“当前句和下一句状态看起来不一致”这类问题时，优先打开 `DevDebugOverlay` 看实际时序，而不是只凭肉眼猜。

特别建议先看 Lyrics 面板里的这些信息：

- `Current Line` / `Next Line`
  用来确认当前 visualizer 实际拿到的是哪一句，以及下一句何时开始
- `start` / `end` / `renderEnd`
  用来区分“逐字 reveal 什么时候应该完成”和“当前句最多还能占用时间轴多久”
- 胶囊状态
  用来快速判断当前句是否已经到 `endTime`、是否仍处于 render hold、以及 `renderEndTime` 会不会被下一句 `startTime` 截断

这一步对排查下面几类问题尤其有用：

- `currentLineIndex` 已经切到下一句，但当前句尾部动画还没收干净
- `renderEndTime` 看起来没有生效，其实是被下一句时间截断
- visualizer 把 `endTime` 和 `renderEndTime` 的职责混用了

## 当前模块化架构

当前目录已经开始按“共享基座 + 各自 renderer”组织，而不是每个 visualizer 都各写一整棵树。

当前推荐目录结构：

```text
visualizer/
├─ colorMix.ts
├─ definition.ts
├─ FumeBackground.ts
├─ PreviewPlaceholder.ts
├─ README.md
├─ registry.tsx
├─ runtime.ts
├─ settingsPanels.tsx
├─ VisPlayground.tsx
├─ VisPlaygroundSettingsPanel.tsx
├─ VisualizerRenderer.tsx
├─ VisualizerShell.tsx
├─ VisualizerSubtitleOverlay.tsx
├─ backgrounds/
│  ├─ definition.ts
│  ├─ registry.tsx
│  ├─ VisualizerBackgroundRenderer.tsx
│  ├─ common/
│  │  ├─ entry.tsx
│  │  ├─ FluidBackground.tsx
│  │  ├─ GeometricBackground.tsx
│  │  └─ CommonBackgroundSettingsCard.tsx
│  ├─ monet/
│  ├─ nomand/
│  ├─ url/
│  └─ sora/
├─ cappella/
│  └─ VisualizerCappella.tsx
├─ classic/
│  └─ Visualizer.tsx
├─ cadenza/
│  └─ VisualizerCadenza.tsx
├─ partita/
│  └─ VisualizerPartita.tsx
├─ fume/
│  └─ VisualizerFume.tsx
├─ claddagh/
│  └─ VisualizerCladdagh.tsx
├─ tilt/
│  └─ VisualizerTilt.tsx
├─ monet/
│  └─ VisualizerMonet.tsx
└─ ...
```

### 1. 共享壳层

- `VisualizerShell.tsx`
  负责：
  - 根容器
  - 返回按钮显隐与点击
  - 调用 `VisualizerBackgroundRenderer`
  - `visualizerOpacity` 和背景模式的外层协调
  - `staticMode` 等通用外层行为

### 2. 共享 runtime

- `runtime.ts`
  当前提供的共享能力包括：
  - `useVisualizerRuntime(...)`
    统一计算：
    - `activeLine`
    - `recentCompletedLine`
    - `upcomingLine`
    - `nextLines`
  - `getRecentCompletedLine(...)`
  - `getUpcomingLine(...)`
  - `getUpcomingLines(...)`
  - `shouldPreheatLine(...)`
  - `prepareActiveAndUpcoming(...)`

这层的目标是统一“播放器运行时上下文”，而不是统一具体的 renderer 细节。

### 3. 共享字幕层

- `VisualizerSubtitleOverlay.tsx`
  负责：
  - 当前句翻译显示
  - 空窗期最近完成句翻译显示
  - 下一句 / 下两句提示显示

### 4. renderer 层

每个 visualizer 仍然保留自己的主歌词渲染引擎：

- `classic/Visualizer.tsx`
  DOM + Framer Motion 的自由散点词布局
- `partita/VisualizerPartita.tsx`
  DOM + Framer Motion 的分列 / 分块布局
- `cadenza/VisualizerCadenza.tsx`
  canvas + DOM overlay 的重型排版 / 动画引擎
- `fume/VisualizerFume.tsx`
  文章式整页排版 + 摄影机追焦 + glyph 级 reveal
- `claddagh/VisualizerCladdagh.tsx`
  以 grapheme timing 驱动的椭圆轨道排版；用预文本测量字符间距，并通过 MotionValue / DOM style 更新环形文字
- `cappella/VisualizerCappella.tsx`
  聊天气泡 / 表情包叙事布局，靠离线测量稳定气泡尺寸
- `tilt/VisualizerTilt.tsx`
  倾斜排版与强调片段，用较少状态表达文字重心变化
- `monet/VisualizerMonet.tsx`
  海报式布局、右侧肖像、关键词着色和底部音频条

不要把这些 renderer 强行揉成一个统一组件。共享的是壳层、runtime、字幕层、预热入口，以及模式注册 / 设置面板挂载方式，不是具体渲染算法。

## 设计提示

这部分不是“应该怎么想象”，而是当前代码里已经在用的设计方式。

### 视觉分层

- 整体是 `VisualizerShell -> renderer -> VisualizerSubtitleOverlay` 三层。
- `VisualizerShell` 负责稳定的沉浸式舞台：底色、封面取色流体背景、几何背景、返回按钮。
- renderer 负责“当前模式独有的排版和动画语法”，例如自由散射、分栏、文章镜头、聊天气泡。
- `VisualizerSubtitleOverlay` 负责翻译、最近完成句、下一句提示，不把这些辅助信息塞进每个 renderer 内部重写。

这套分层的目的不是纯粹复用，而是把“舞台氛围”和“歌词叙事方式”拆开。切模式时，用户保留同一套播放器世界观，只切换歌词语言本身。

### 动态组织方式

- 当前 visualizer 普遍避免“整个界面跟着每个字一起抖”。更常见的做法是先稳定布局，再让文字、局部高光、镜头或小物件运动。
- `theme.animationIntensity` 主要控制运动幅度和节奏，不应该改变一个模式最基本的排版逻辑。
- `staticMode` 约定为关闭重背景、重几何、重绘制，不是把歌词动画全部杀掉。
- 播放页和预览页尽量共用同一组件，只通过 `isPreviewMode`、seed、preview offset 控制体验差异，避免预览和真实播放脱节。

### 当前在用的 trick

#### 1. 预热 upcoming line，而不是等切句再临时算

- 共享 runtime 只负责给出 `activeLine / upcomingLine / nextLines` 和 `shouldPreheatLine(...)` 这类轻量入口。
- 真正的 prepare / cache 仍由各 renderer 决定。
- `partita` 会缓存分栏布局，并在进入窗口时顺手准备下一句。
- `cadenza` 和 `fume` 这种更重的模式，也都倾向于把“当前句准备”与“下一句预热”绑在同一条流水线里。

这样切句时不会突然出现布局跳变或大块同步计算。

#### 2. `pretext` 做离线测量，先知道尺寸，再决定怎么演

- `cappella` 不依赖真实 DOM 先渲染一遍再读尺寸，而是用 `@chenglou/pretext` 的 `prepareWithSegments` + `layoutWithLines` 先离线测量文本。
- 这让它在气泡真正进入画面前，就知道大概需要多少宽高，能先把头像、气泡、表情包位置排稳。
- 它还会额外测到“当前可见字符数 + 少量 lookahead 字符”，避免逐字 reveal 时气泡每一帧都跟着重新长大。

这个思路的重点不是绝对精准，而是“视觉上提前占位”，让聊天叙事看起来像一串已经准备好的消息，而不是正在疯狂 reflow 的 DOM。

#### 3. Claddagh 用 grapheme timeline 驱动轨道排版

- `claddagh` 通过 `buildLineGraphemeTimeline()` 把 `Line.words` 的 timing 映射到 grapheme，并对空格等零时长片段做局部时间修正。
- 字符宽度由 `@chenglou/pretext` 测量并写入有界 cache，避免每个 frame 重算字体 advance。
- 播放期间只保留当前行附近的有限 ring line；`useLayoutEffect` 直接更新字符的 transform、opacity、filter 和 glow，中心轴线的音频响应走独立 RAF。
- 因此新增或调整 Claddagh 动画时，重点检查 MotionValue 订阅、RAF/ResizeObserver cleanup 和 ring line 数量，不要把每个字符的连续状态放进 React state。

#### 4. 先定布局，再做 reveal

- `partita` 的核心是先把列和块的位置定住，再让词在既有轨道内进入 `waiting / active / passed` 三态。
- README 里原来提到的那句“layout should feel stable while the words are moving through it”，现在仍然是这个模式最重要的设计约束。
- 这样用户感知到的是“词在穿过结构”，而不是“结构跟着词重新搭”。

#### 5. Fume 走整篇文章级排版，不按单句临时拼

- `fume` 会先构建 article layout，把整首歌词拆成 block / render line / grapheme 级结构。
- 它会做多轮 measurement attempt，比较不同列数和排版结果，再选较优方案。
- 每个 segment 会提前测 `measuredGlyphOffsets`，后续 reveal、clip、镜头追焦都直接复用这些偏移，而不是每次渲染再现算文本宽度。
- `layoutBuildVersionRef` 这类版本号保护也在用，避免较慢的一次异步布局结果把较新的结果回写覆盖。

这类模式的关键不是某个 motion 参数，而是把昂贵的“文本几何学”尽量前置到 layout build 阶段。

#### 6. 模式设置面板跟模式入口绑定，而不是继续堆到全局预览器

- 现在 registry entry 不只负责 `render`，还可以挂 `renderSettingsPanel` 和 `resetSettings`。
- `settingsPanels.tsx` 承载多数内置模式面板；复杂模式也可以把面板放在模式相邻文件，例如 `monet/MonetSettingsPanel.tsx`。
- 这能避免 `VisPlayground.tsx` 继续膨胀成“所有模式逻辑的大分支文件”。

如果以后新增模式也需要复杂视觉调参，优先延续这条链路。

#### 7. 视觉调参必须能备份和恢复

- visualizer 模式、背景模式、通用透明度、字体字号和所有 renderer tuning 都属于视觉配置。
- 当前导入导出入口在 `src/components/modal/settings/AppearanceSettingsSubview.tsx`。
- 新增视觉设置时，必须同步 `buildCurrentConfig`、`compressConfig`、`decompressConfig`、JSON `validKeys` 和 `handleImportConfig`。
- 不要只在 `useSettingsUiStore.ts` 持久化，却漏掉 shortcode / JSON 导入导出。

## 推荐的内部结构

新 visualizer 推荐保留下面这层组合关系：

1. `VisualizerShell`
2. renderer 主歌词层
3. `VisualizerSubtitleOverlay`

也就是：

```tsx
<VisualizerShell ...>
    <YourRenderer ... />
    <VisualizerSubtitleOverlay ... />
</VisualizerShell>
```

这样可以保证新增模式自动继承现有播放器体验，而不会把背景、按钮、字幕、空态逻辑再复制一遍。

## 推荐复用的工具和方法

实现新 visualizer 时，优先复用现有共享层和歌词渲染辅助工具，而不是自己再发明一套外层 runtime。

常用工具：

- `getLineRenderEndTime`
  作用：获取一行歌词实际应渲染到何时结束
- `getLineRenderHints`
  作用：读取当前行的渲染提示，例如过渡模式、逐词 reveal 模式
- `getLineTransitionTiming`
  作用：给更复杂的入场/退场计算提供统一时序
- `resolveThemeFontStack`
  作用：根据主题和自定义字体解析实际 `font-family`

常用共享模块：

- `VisualizerShell`
  作用：复用背景、返回按钮、外层容器
- `VisualizerSubtitleOverlay`
  作用：复用底部翻译 / 下一句提示
- `useVisualizerRuntime`
  作用：统一当前句、最近完成句、下一句和预热上下文
- `shouldPreheatLine`
  作用：统一“是否进入预热窗口”的判断
- `prepareActiveAndUpcoming`
  作用：在 renderer 内部统一“当前句 + 下一句”的预备流程

如果新模式也有“逐词激活 / 已播放 / 未播放”状态，建议保持和现有模式一致的三态语义：

- `waiting`
- `active`
- `passed`

这样更容易复用已有的视觉语言和 render hints。

### `endTime` 与 `renderEndTime` 的职责区别

- `line.words[*].endTime` 与整句 `line.endTime`
  语义：逐词 / 逐字 reveal 的真实完成时间。到这里时，最后一个字本身应该已经完成渲染。
- `renderEndTime`
  语义：visualizer 最长允许继续占用时间轴的结束点，用于 active -> passed、尾迹、退场等视觉过渡。

这两个时间点不要混为一谈：

- `endTime` 负责“字什么时候应该出现完”
- `renderEndTime` 负责“当前句最多还能留在屏幕上多久”

另外，`renderEndTime` 不是独立于下一句存在的硬时间轴。
如果下一句 `startTime` 更早到来，当前句的额外过渡窗口会被截断。
visualizer 在这种情况下应当直接补完成当前句剩余的 pass / trail 状态，而不是继续拖着半截 active 动画跨到下一句之后。

## 预热与缓存

当前架构把“预热入口”收敛到了共享 runtime 层，但缓存内容仍然由各 renderer 自己决定。

### 已有模式

- `partita/VisualizerPartita.tsx`
  使用布局缓存，并在进入时间窗口时预热下一句布局
- `cadenza/VisualizerCadenza.tsx`
  使用更重的 prepared-state 缓存，并在计算当前句时顺手准备 upcoming line
- `classic/Visualizer.tsx`
  当前没有专门的重型预热层，保持即时布局计算
- `claddagh/VisualizerCladdagh.tsx`
  不建立整句 layout cache；使用有界的 grapheme 间距 cache，并只渲染当前行前后一小段轨道内容

### 设计原则

- 统一的是：
  - `upcomingLine` 的选择方式
  - 预热触发入口
  - runtime 上下文
- 不统一的是：
  - cache 存储结构
  - renderer 的具体 prepare 产物
  - 各模式独有的布局 / 动画算法

如果你要新增一个 renderer，建议先判断它是否存在明显的 prepare 成本：

- 如果 prepare 很轻，直接即时计算即可
- 如果 prepare 很重，再接入共享的 preheat 入口和本地 cache

## 最小实现骨架

下面是一个推荐骨架，可以作为新文件起点。

重点有两个：

- renderer 组件本身直接接 `VisualizerSharedProps`，不要再单独定义一份过时的 `VisualizerFooProps`
- 通用外层行为优先通过 `VisualizerShell` 的 `sharedProps={props}` 透传，只有模式真的需要覆写时才单独传字段

```tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import { type VisualizerSharedProps } from '../definition';
import { useVisualizerRuntime } from '../runtime';
import VisualizerShell from '../VisualizerShell';
import VisualizerSubtitleOverlay from '../VisualizerSubtitleOverlay';

type VisualizerFooProps = VisualizerSharedProps;

const VisualizerFoo: React.FC<VisualizerFooProps> = (props) => {
    const {
        currentTime,
        currentLineIndex,
        lines,
        theme,
        audioPower,
        audioBands,
        showText = true,
        lyricsFontScale = 1,
        isPlayerChromeHidden = false,
        hideTranslationSubtitle = false,
        showSubtitleTranslation = true,
    } = props;
    const { t } = useTranslation();
    const { activeLine, recentCompletedLine, nextLines } = useVisualizerRuntime({
        currentTime,
        currentLineIndex,
        lines,
        getLineEndTime: getLineRenderEndTime,
    });

    return (
        <VisualizerShell
            theme={theme}
            audioPower={audioPower}
            audioBands={audioBands}
            sharedProps={props}
        >
            <div className="relative z-10 w-full h-[70vh] flex items-center justify-center p-8 pointer-events-none">
                {showText && activeLine ? (
                    <div style={{ fontSize: `${3 * lyricsFontScale}rem` }}>{activeLine.fullText}</div>
                ) : (
                    <div>{t('ui.waitingForMusic')}</div>
                )}
            </div>

            <VisualizerSubtitleOverlay
                showText={showText}
                activeLine={activeLine}
                recentCompletedLine={recentCompletedLine}
                nextLines={nextLines}
                theme={theme}
                translationFontSize="1rem"
                upcomingFontSize="0.875rem"
                isPlayerChromeHidden={isPlayerChromeHidden}
                hideTranslationSubtitle={hideTranslationSubtitle}
                showSubtitleTranslation={showSubtitleTranslation}
            />
        </VisualizerShell>
    );
};

export default VisualizerFoo;
```

## 接入一个新 visualizer

实现组件本身之后，新增模式只需要创建自己的注册入口：

```text
visualizer/
└─ foo/
   ├─ VisualizerFoo.tsx
   └─ entry.tsx
```

`entry.tsx` 使用 `defineVisualizer(...)` 默认导出注册对象：

```tsx
import React from 'react';
import { defineVisualizer } from '../definition';
import VisualizerFoo from './VisualizerFoo';

// src/components/visualizer/foo/entry.tsx
// Registers the Foo visualizer mode.
export default defineVisualizer({
    mode: 'foo',
    order: 50,
    labelKey: 'ui.visualizerFoo',
    labelFallback: 'Foo',
    previewSeed: 'foo',
    previewStartOffset: 0,
    tuningKind: 'none',
    render: props => <VisualizerFoo {...props} />,
});
```

如果模式入口需要先调整 shared props，再喂给 renderer，也应该在 `entry.tsx` 做，而不是改“最小骨架”里的 renderer 签名。例如 `cadenza/entry.tsx` 当前会先把 `lyricsFontScale` 折算进 `cadenzaTuning.fontScale`，再渲染 `VisualizerCadenza`。

`registry.tsx` 会通过 `import.meta.glob('./*/entry.tsx', { eager: true })` 自动发现所有入口。播放器、模式列表、预览面板和主题预览都继续读取同一份 registry，不需要再去手动 import 新组件或改 `VisualizerRenderer.tsx`。

模式专属 tuning 还需要在同目录提供 `tuning.ts`。`tuningRegistry.ts` 会自动发现这些纯数据 adapter，并用统一的 `VisualizerTuningBundle` 在播放器、OBS、ThemePark、预览和设置同步之间传输；adapter 负责把当前模式的强类型 tuning 注入 renderer。shell 背景配置统一通过 `VisualizerBackgroundConfig` 传输，不属于 visualizer tuning bundle。

## 接入一个新 background

每种 shell 背景都放在独立目录中，渲染层、设置卡和入口不要散落到 `visualizer/` 或 `backgrounds/` 根目录：

```text
backgrounds/
└─ foo/
   ├─ entry.tsx
   ├─ FooBackgroundLayer.tsx
   └─ FooBackgroundSettingsCard.tsx
```

`backgrounds/registry.tsx` 会自动发现 `backgrounds/*/entry.tsx`。入口通过 `defineVisualizerBackground(...)` 声明模式、排序、渲染函数和可选设置面板；`VisualizerShell`、Playground 背景下拉框和设置区域会读取同一份 registry，因此新增背景不需要再修改这些调用方。

背景模块只接收 `VisualizerBackgroundConfig` 和 `VisualizerBackgroundActions` 中属于自己的字段，不直接读取 `useSettingsUiStore`。这样可以避免 registry 与 store 形成初始化循环，也能让播放器、ThemePark 和 OBS 复用同一份配置。

如果新模式需要预览面板专属设置，可以在 entry 上提供：

```tsx
renderSettingsPanel: props => <FooSettingsPanel {...props} />
```

如果还需要提供“恢复默认参数”能力，也沿用当前 entry 接口：

```tsx
resetSettings: props => {
    props.resetFooTuning?.();
}
```

### 仍然可能需要同步的文件

#### `src/types.ts`

`VisualizerMode` 已允许未来模式字符串，不再要求每个新模式都改模式联合类型。

如果有专属调参，仍建议新增：

- `FooTuning`
- `DEFAULT_FOO_TUNING`

#### `src/hooks/useAppPreferences.ts`

如果新模式需要用户可调参数：

- 读取本地存储
- 提供 `handleSetFooTuning`
- 提供 `handleResetFooTuning`

#### `src/components/visualizer/VisPlayground.tsx`

预览面板入口仍然可能需要改，但重点不再是“注册组件”，而是：

- 增加预览调参 UI
- 确认是否需要针对新模式补额外控制项
- 复用 registry 提供的模式标签和 preview seed / offset

优先把共享设置放在 `VisPlaygroundSettingsPanel.tsx`，把专属控制拆到模式相邻文件，再由 entry 的 `renderSettingsPanel` 挂回预览面板，避免继续在 `VisPlayground.tsx` 里堆模式分支。

#### `src/components/modal/SettingsModal.tsx`

如果设置面板需要打开预览器，通常这里还要：

- 透传新的 tuning props 到 `VisPlayground`
- 如果新增了新的调参能力，补设置入口

模式按钮列表当前由 registry 生成，不应再手写内置模式分支。

新增设置还要判断是否触发 `skills/settings-feature-integration/SKILL.md`：

- 视觉相关设置必须接入 `AppearanceSettingsSubview.tsx` 的导入导出。
- 功能性设置或可执行动作必须接入 `src/components/command-palette/commandRegistry.ts`。

#### `src/components/modal/ThemePark.tsx`

主题预览器也会复用同一套 renderer。

如果你的模式会在主题预览中明显受益于专属 tuning，这里也要确认对应 props 已经透传。

#### `src/components/app/Home.tsx` / `src/components/Home.tsx`

如果 `SettingsModal` 的 props 发生变化，通常需要先检查 app-level dialogs 包装层，再同步全局设置入口。

#### 文案文件

至少同步：

- `src/i18n/locales/zh-CN.ts`
- `src/i18n/locales/en.ts`

任何新增到 UI 上的用户可见文本都必须准备 i18n key 并写入这两个文件，包括模式名、设置项、tooltip、按钮、空态和 toast。`labelFallback` 只能作为 registry 兜底，不能替代正式字典项。

常见文案包括：

- 模式名
- 模式参数标题
- 参数描述
- 切换提示文案

## 设计约束和建议

### 1. 不要直接假设 `lines[currentLineIndex]` 一定存在

所有模式都要容忍：

- `currentLineIndex = -1`
- 空歌词数组
- 间奏空白段

### 2. 不要绕开 `lyricsFontScale`

用户样式设置面板会统一控制字号，如果新模式忽略它，会导致该模式和其它模式体验不一致。

### 3. 调参应通过 props 注入

如果某个参数会进入设置面板，就不要只写成文件顶部常量。应该：

- 在 `types.ts` 定义 tuning
- 在 `useAppPreferences.ts` 持久化
- 在统一 renderer 和对应设置入口中传入

### 4. 尽量保持背景层行为一致

建议继续复用：

- `FluidBackground`
- `GeometricBackground`
- 左上返回按钮交互

这样不同模式切换时，用户不会感觉整套播放器逻辑被打散。

### 5. 预览和实际播放必须一致

`VisPlayground` 不应该使用和播放器完全不同的一套参数解释方式。预览应尽量复用真实组件，而不是复制一个“假实现”。

## 自检清单

### PR 性能门槛

这段要求是写给人类开发者的：如果你要提交任何 visualizer 相关 PR，必须先在浏览器性能工具里完成一次性能确认。

验证标准如下：

- 目标场景：4K 分辨率, 播放页面
- 目标平均帧率：120 FPS （也允许更低的帧率门槛，例如 60 FPS，但必须保证没有明显掉帧）
- 验证环境：移动版 Intel Core i7-12700H 级别处理器，Nvidia RTX 3060级别显卡，或者类似性能的现代桌面硬件，`dev` 模式。
- 验证方式：完整播放完一首歌，这里推荐几个例子：
  - `Never Gonna Give You Up - Rick Astley` (普通歌词长度和切换频率，适合一般测试)
  - `Lagtrain - Will Stetson` (大量长英文歌词，适合测试文本渲染性能)
  - `Credits EX - Frums` (极高频率歌词切换，适合暴露性能问题)
- CPU 门槛：整首歌播放期间 CPU 平均占用不能高于 60%，允许偶尔的短时峰值，但不能持续超过 10 秒的 99% 占用
- 失败条件：如果出现任何一次持续超过 10 秒的 99% CPU 占用，或者明显导致UI掉帧（进度条动画不流畅，面板切换掉帧）直接视为性能问题，必须先解决，再提交 PR

以上要求没有限制 GPU 占用，因为高 GPU 负载不一定等同于性能问题，尤其是在高帧率情况下。但 CPU 占用过高往往直接导致主线程阻塞，会非常明显地影响用户体验。

新增一个 visualizer 后，提交前至少检查下面几项：

- 是否默认导出组件
- 是否兼容 `VisualizerSharedProps`
- 是否处理 `activeLine` 不存在的情况
- 是否支持 `showText = false`
- 是否正确使用 `lyricsFontScale`
- 是否没有用 `useState` / store / reducer 每帧保存当前精确时间
- 是否所有新增 UI 文案都已经写入中英文 i18n 字典
- 是否所有新增颜色都从当前 light / dark theme 动态派生
- 是否在 `staticMode` 下关闭重背景动画
- 是否已经创建 `<mode>/entry.tsx` 并由 registry 自动发现
- 是否经过统一 renderer 验证
- 是否已经接入 `VisPlayground.tsx` 的专属设置面板（如果需要）
- 是否已经接入 `ThemePark.tsx`（如果需要专属 tuning）
- 如果新增视觉设置，是否已经接入外观页 shortcode / JSON 导入导出
- 如果新增功能性设置或动作，是否已经接入 command palette
- 是否补充了中英文文案
- 如果有调参，是否完成本地存储和重置逻辑

## 建议命名

新增模式建议使用以下命名习惯：

- 文件名：`VisualizerFoo.tsx`
- 组件名：`VisualizerFoo`
- 模式值：`'foo'`
- tuning 类型：`FooTuning`
- 默认 tuning：`DEFAULT_FOO_TUNING`

保持这套命名后，后续接设置面板、偏好存储和预览会更顺。
