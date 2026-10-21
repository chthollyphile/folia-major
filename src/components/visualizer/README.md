# Visualizer 代码地图

Visualizer 是一个由共享 shell/runtime/registry 组合多个歌词渲染模式的目录。新增或修复模式时，先从统一入口定位，不要从 `App.tsx` 复制渲染分支。

## Runtime flow

```text
App / ThemePark / VisPlayground / OBS source
  -> VisualizerRenderer.tsx
       -> useDeferredValue(mode)（新样式的代码到了才换，之前旧样式留在屏幕上）
       -> registry.tsx（按 VisualizerMode 找到 <mode>/entry.tsx）
       -> backgrounds/registry.tsx（默认背景）
       -> applyVisualizerTuning()
       -> VisualizerBackdrop.tsx（背景、视频层、整体透明度；换样式时留着不动）
            -> mode renderer
       -> VisualizerHarmonyOverlay
```

背景、视频层和整体透明度由 `VisualizerBackdrop.tsx` 在样式外面画一次，所有样式共用，换样式时不重来。样式要的背景写在 entry 的 `background` 字段上（见下面“加一个歌词动画样式”）。

共享外壳在 `VisualizerShell.tsx`：透明容器、字体栈/字重、返回按钮和 player-panel hotspot。外壳在 `VisualizerBackdrop` 里面时不画背景、视频层和透明度；没有 `VisualizerRenderer` 包着时（选择器的小图、mod 导出页、开发探针）才自己画。底部/翻译字幕通常由 `VisualizerSubtitleOverlay.tsx` 或模式自身按既有契约处理。共享契约在 `definition.ts`，不要在模式组件里重新声明一套歌词 props。

两组字幕字号（译文 / 下一句预览）只有一处来源：`subtitleFontSizes.ts` 的 `resolveSubtitleFontSizes(lyricsFontScale)`。模式间切换时它们不能跳字号，所以别在模式里再抄一份 clamp。

运行时辅助在 `runtime.ts`：

- `useVisualizerRuntime`
- `getRecentCompletedLine`
- `getUpcomingLine` / `getUpcomingLines`
- `shouldPreheatLine`
- `prepareActiveAndUpcoming`

这些函数统一当前行、上一句、下一句和预热窗口；不要在新模式中重新扫描 `lines`。

## Current mode registry

每个模式通过 `src/components/visualizer/<mode>/entry.tsx` 注册，registry 使用 Vite `import.meta.glob('./*/entry.tsx', { eager: true })` 自动发现。

模式清单就是本目录下带 `entry.tsx` 的子目录，这里不抄一张表：显示名、排序和 renderer 写在各自的 `entry.tsx` 里，有设置的模式旁边还有 `tuning.ts`。各模式的辅助文件见下面的 Mode-specific navigation。

内建模式的 id 清单是 `src/types/visualizerModes.ts` 的 `BUILTIN_VISUALIZER_MODES`（背景是同一文件的 `BUILTIN_VISUALIZER_BACKGROUND_MODES`）。store、同步、OBS 短码只需要判断一个字符串是不是合法模式时用它，不 import registry；registry 启动时核对它和目录里的 `entry.tsx` 一致，对不上就抛错。`src/types.ts` 里的 `BuiltinVisualizerMode` 只列了五个名字，是旧的类型，不是清单。

`registry.tsx` 的默认模式是 `classic`。共享 props 和 tuning 表见 `definition.ts`、`tuningRegistry.ts`；一个模式的 `tuning.ts` 该写什么见 `tuningDefinition.ts`。加一个模式按下面的“加一个歌词动画样式”做。

## 加一个歌词动画样式

下面用 `foo` 代表新样式的 id，`Foo` 代表它在文案键里的写法。这个样式的文件都放进 `foo/`：entry、tuning、类型和默认值、设置面板、渲染器、只给它用的 layout 和纯函数（一个功能的代码放在一起，见 `skills/file-modularization/SKILL.md`）。`foo/` 之外只改下面列出的几处。

### 必须做的

1. `foo/entry.tsx`：默认导出 `defineVisualizer({...})`（`definition.ts`）。必填 `mode: 'foo'`、`order`（在选择器里的先后）、`labelKey: 'ui.visualizerFoo'`、`labelFallback`、`previewSeed`、`previewStartOffset`、`render`。renderer 用 `React.lazy` 包起来：registry 用 eager glob 读所有 entry，静态 import 会让碰到 visualizer 设置的模块都拉进全部 renderer。可以照 `still/entry.tsx`（没有设置）或 `lumiere/entry.tsx`（设置面板在自己目录里）写。
2. 把 `'foo'` 加进 `src/types/visualizerModes.ts` 的 `BUILTIN_VISUALIZER_MODES`。漏了的话：启动时 `registry.tsx` 抛错；`src/stores/visualizerSettingsPersistence.ts` 把存着的 `foo` 读回成 `classic`；OBS 链接里写的 `foo` 被忽略（`src/utils/obsWebAppearance.ts`）。
3. 切到这个样式的命令和小图标：写在 `entry.tsx` 的 `command`（title、description、keywords）和 `glyph` 里，命令清单按 registry 生成，命令 id 是 `visualizer-foo`。
4. 文案，三份语言文件 `src/i18n/locales/en.ts`、`zh-CN.ts`、`in.ts` 都加：`ui.visualizerFoo`，和 `commandPalette.commands.visualizer-foo` 的 `title`、`description`。缺一份 `test/unit/command-palette/commandRegistryContract.test.ts` 就失败；关键词写英文和中文，不要手写拼音（同一个测试会拦）。这个测试的命令顺序快照会多一条，确认只多了 `visualizer-foo` 后更新快照。
5. 性能测量：`dev/perf/scenarios.mjs` 的 `STYLES` 加一行 `[id, 显示名, 怎么画]`，就有了测量场景 `style-foo` 和换歌的比对图 `songchange-foo`（见 `dev/perf/README.md` 的 Adding a scenario）。

### 背景和默认的不一样时

样式默认画在用户选的背景上，`entry.tsx` 什么都不用写。背景由 `VisualizerBackdrop` 画，要改它写在 entry 的 `background` 字段上（`definition.ts`）：

- 不要背景：`background: false`（照 `still/entry.tsx`）。
- 改背景的设置：写一个函数，拿样式的 props，返回要用的背景设置（照 `fume/backgroundConfig.ts`，浮名默认关掉几何图形）。

只在样式自己的 `VisualizerShell` 上改（`renderBackground={false}`、传别的 `background`）不够：在 `VisualizerRenderer` 里外壳不画背景，这些只在外壳单独用时（小图、mod 导出页）起作用。两处要一致时，像浮名那样让 entry 和渲染器用同一个函数。

### 起步慢的样式

样式第一次画出来要很久时（编译着色器、把整首歌排一遍），换到它的过渡会在半路卡住。这样的样式在画好第一帧时说一声：调 `styleTransition/firstFrame.ts` 的 `useFirstFrameDrawn()`，画好第一帧（或者失败、改画别的）时调它返回的函数。换样式会等这一声再放过渡，最多等 `FIRST_FRAME_LIMIT_MS`。用 `pixi/pixiRuntimeHost.ts` 的样式已经由它说了；照 `fume/VisualizerFume.tsx`（排好、画完时）、`diorama/VisualizerDiorama.tsx`（three.js 第一次画完时）写。起步不慢的样式什么都不用写，挂上就算画好。

### 有设置的样式

1. `foo/tuning.ts`：默认导出 `defineVisualizerTuning({...})`（`tuningDefinition.ts`），写 `mode`、`defaults`、store 里的三个字段名（`settingsKey`、`settingsSetterKey`、`settingsResetterKey`）和 `storage`（存储键 `key`、`read`、`merge`，可选 `resetNotice`）。再用 `declare module '../tuningDefinition'` 把三个字段的类型加进 `VisualizerTuningSettings`（照 `tilt/tuning.ts` 开头那几行）。存储键发布后不能改名。
2. tuning 的类型和默认值放在 `foo/` 里（例如 `foo/types.ts`）。现有样式的写在 `src/types.ts`（`TiltTuning`、`DEFAULT_TILT_TUNING`），那是按功能放之前的放法。
3. 渲染器拿 tuning：在 `entry.tsx` 里用 `tuning.ts` 默认导出的 `read(props.visualizerTunings)` 取，这样不用给 `definition.ts` 加 prop，`apply` 也不用写。现有样式用 `apply` 把 tuning 放到一个具名 prop 上，那要在 `VisualizerSharedProps` 里加字段。
4. 设置面板：`foo/FooSettingsPanel.tsx`，用设置窗口的共用控件（`src/components/modal/settings/kit`）画，在 `entry.tsx` 的 `renderSettingsPanel` 挂上（照 `pendolo/PendoloSettingsPanel.tsx`、`lumiere/LumiereSettingsPanel.tsx`）。新样式的面板不要再加进 `settingsPanels.tsx`。面板里每组的标题键（`SettingsGroupDef` 的 `titleKey`，现有的放在 `options.` 下，例如 `options.tiltSettings`）和 `resetNotice` 的键（现有的叫 `notifications.<样式>Reset`）三份语言文件都要写。
5. 播放面板的快捷参数（可选）：在 `entry.tsx` 的 `renderQuickControls` 挂上常调的几项，它拿到的是已保存的 tuning 和立刻保存的 `onTuningChange`。开关用 `src/components/shared/QuickControlChip.tsx` 的 `QuickControlToggle`（图标），几项里轮换用 `QuickControlChip`（写当前值），标签沿用设置面板里的键。面板把它们放在歌词样式那一行下面；没有就不出这一行。
6. 测试里钉住已存数据的两处要跟着改：`test/unit/visualizer/storedSettingsPins.test.ts`（把新键加进它的 `CURRENT` 和 `DEFAULTS`，钉住读写结果；它的快照会多出新样式的 tuning）和 `test/unit/stores/storeContract.test.ts`（存储键快照会多一个键）。确认多出来的只有新样式的东西后再更新快照。

### 不用改的

- 发现和挂载：`registry.tsx` 按 `foo/entry.tsx` 找到它，`tuningRegistry.ts` 按 `foo/tuning.ts` 找到 tuning。
- 背景、视频层和整体透明度：`VisualizerBackdrop.tsx` 画，换样式时留着；渲染器不用画它们。
- 选择器、命令面板的样式命令、小图标、预览图：都从 registry 读。预览图由 `preview/LyricStylePicture.tsx` 用真的样式现画，不用准备图片。
- 设置仓库：`useVisualizerSettingsStore` 和 `visualizerSettingsPersistence.ts` 按 `tuning.ts` 的声明生成字段和改、恢复默认两个动作。歌词样式窗口的草稿、保存和「默认」也是通用的（`window/useTuningDrafts.ts`）。
- 导出、导入、同步、OBS：tuning 随 `visualizerTunings` 这一个字段走，不要加新字段（`test/unit/visualizer/tuningBundleTransport.test.ts` 按目录找 `tuning.ts`，新样式不用改它）。
- `test/unit/visualizer/builtinModeLists.test.ts`：做了第 2 步就会通过。

### 由 mod 提供样式

不改内建代码、由 mod 加一个歌词动画样式的做法，见 [`docs/folium/api.md`](../../../docs/folium/api.md) 和 [`docs/folium/contributing.md`](../../../docs/folium/contributing.md)。mod 的样式 id 是 `mod:<mod id>:<样式 id>`，不进 `BUILTIN_VISUALIZER_MODES`。mod 样式要不要宿主画背景写在 `hostLayers.background`，`src/mods/folium/registries/visualizers.tsx` 按它填 entry 的 `background`。

## Background registry

背景 entry 位于 `backgrounds/<name>/entry.tsx`，由 `backgrounds/registry.tsx` 发现；背景清单就是 `backgrounds/` 下带 `entry.tsx` 的子目录，渲染层和设置卡在各自目录里。

共享背景 props 与默认值在 `backgrounds/definition.ts`；实际渲染在 `backgrounds/VisualizerBackgroundRenderer.tsx`，由 `VisualizerBackdrop.tsx` 的 `VisualizerBackdropLayers` 挂上（外壳单独用时也是它）。新增背景不要在每个 visualizer 中内联。

背景画的东西跟着歌变时（封面、种子），在 entry 写 `song`，返回它画的那几样（照 `common/entry.tsx`、`monet/entry.tsx`）：这几样变了，换歌时背景整个换成新的一份，在放过渡的宿主里用柔焦换，别处直接换。新的那一份要先读东西（解码封面、做图）时，用 `styleTransition/firstFrame.ts` 的 `useFirstFrameDrawn()`，读好时调它返回的函数（照 `common/FluidBackground.tsx`）；不调的挂上就算好了。主题颜色不写进 `song`：调色时颜色一直在变，主题也常在换歌之后才到，写进去每一步都会挂一份新的。换走的那一份留着它自己的封面、种子和主题颜色：混音时下一首的主题先到，也不会画到上一首的背景上。再挂一份很贵的背景（隐现、空：每份都要重新编译着色器）不写 `song`，在原来那一份里把颜色慢慢换过去：用 `backgrounds/useBlendedColors.ts`，时长是渲染 props 的 `blendMs`（放过渡的宿主里是柔焦的长度，别处是 0，直接换）。

混音过渡里画交接的样式（entry 写 `followsSongHandoff`，现在只有莫奈）：过渡一开始，`VisualizerRenderer` 就把下一首的封面、种子和主题交给背景，背景照上面的换歌过渡换，只是这个过渡跟着交接进度走（`styleTransition/layerTransition.ts` 的 `alongProgress`；隐现、空的换色跟着渲染 props 的 `blendProgress`），长度就是过渡的长度。过渡结束时背景已经是下一首，不再换；中途取消时按平常换歌换回去。静态模式和减少动效时没有交接，过渡结束时才换歌。主题跟着画面上的歌：混音一开始实时主题就换成下一首的，但样式拿到的 `theme` 在整个过渡里都是上一首的，取消回到上一首时也是（`useShownTheme.ts`）；下一首的主题放在 `songHandoff.theme` 里。

## Shared contracts and helpers

### `definition.ts`

`VisualizerSharedProps` 是模式共同输入，包含 `MotionValue currentTime`、当前行/全部歌词、主题与字幕主题、音频分析值、背景/透明度、字幕显示开关、播放状态、seek/back/panel callbacks、资源和模式 tuning。完整字段以代码为准；本 README 只保留定位信息。

有 `tuning.ts` 的模式各有自己的 tuning，并通过 `VisualizerRenderer` 的 `applyVisualizerTuning` 统一注入。`tuning.ts` 还写明这份 tuning 存在哪个键、怎么读、怎么合并改动（`storage`）：设置仓库（`useVisualizerSettingsStore`）按这份声明生成字段、改和恢复默认两个动作，仓库和 `src/stores/visualizerSettingsPersistence.ts` 里没有哪个模式的专门代码。背景同理：`backgrounds/<mode>/tuning.ts`；不是一整个对象的设置写在背景目录的 `settings.ts` 里（现在只有 `backgrounds/url/settings.ts`）。模式级设置面板由各自 `entry.tsx` 的 `renderSettingsPanel` 提供，歌词样式窗口给每个面板同一组 props（`tuning`、`onTuningChange`、`settings`、拖动开始和结束）；草稿、保存和「默认」都在窗口里按声明通用处理（`window/useTuningDrafts.ts`）。

### 智能动感模式（beat FX）

全局一个三档总设置，加每个「动感效果」自己的开关和强度（`SmartBeatSettings`，store 的 `smartBeat`：`mode` 和按效果 id 存的 `effects`），不属于任何一个模式的 tuning。三档是 `off` 关闭、`cached` 只用已分析（只读存盘的拍点和鼓点，包括 automix 存的拍点，从不启动推理；没分析过的歌保持原画面）、`on` 开启（没分析过的歌当场在 GPU 上分析）；判断一律走 `smartBeatActive` / `smartBeatMayAnalyse`（`services/beatFx/beatEffects.ts`）。存盘、同步和导出时另带一个 `enabled`（只有 `on` 为 true），给没有三档的旧版本读。总设置单独在可视化设置窗口的「全局」页（`SmartBeatSettingsCard.tsx`）；效果在「歌词动画」页各模式自己的设置里，样式选项上面（`BeatEffectsGroup.tsx`），总设置关着时那里的提示带一颗直达「全局」页的按钮：每个效果一行，四字名、说明、开关，开着时下面一条强度滑杆，0–2×，1× 是调好的样子，在滑杆正中间，没动过的效果按 1×。

效果登记在模式和背景的 entry 上（`beatEffects`，类型和 id 在 `services/beatFx/beatEffects.ts`）：每个效果有 id（`<模式>.<名字>`，存盘和导出都用它）、名字和说明的 i18n key、读哪路数据（`source`：`'beats'` 是 beat_this 的拍点，`'drums'` 是 htdemucs 分出的鼓点）。一个模式以后可以有好几个效果，加一条就行，设置界面和模型调度自动跟上。现在的效果：商籁「推镜裂光」（beats）、镜台「水镜涟漪」（beats）、时计「仿真鼓面」（drums）。`retired: true` 的效果代码和登记都在，但不跑也不出现在设置里：时计的「齿轮随拍」和隐现背景的「潮汐脉动」（2026-10-17 用户先搁置）。

`beatClockTargets.ts` 按屏上的模式和背景、哪些效果开着，算出要不要 beat_this（`visualizerWantsBeats`）、要不要 htdemucs（`visualizerWantsDrumHits`）：只有读它的效果开着才跑那个模型。时计只开仿真鼓面时 beat_this 完全不跑，节拍时钟只带曲目 key 和听到的时间（`useBeatFxTrack.ts`）。每帧的效果按自己的 id 问 `beatFxLive` 的 `getBeatEffectStrength`（不播时为 0）；读 `beatImpact` / `downbeatImpact` 的拍点效果，强度已由时钟乘好（轻拍、重拍都取屏上那个拍点效果的强度）。旧的全局轻拍 / 重拍两个强度在读存盘和导入时折成商籁、镜台效果的强度（两者平均，默认 1 / 1 仍是 1）。不显示背景的模式本来就写着 `background: false`（Still）。

各自的读法：从 `motionSignals` 的 `beatImpact` / `downbeatImpact`（时钟已经乘好强度）读包络，要离散触发的（镜台每拍一个涟漪）读 `beatFxLive` 的 `getBeatFxFiredCounts`；一律先看 `isBeatFxReady()`（鼓点效果看自己的 `getBeatEffectStrength` 和 `getDrumHits`），没就绪就走原来的画面，所以关着时像素不变。商籁 `sonnet/sonnetBeatFx.ts`，镜台 `diorama/dioramaBeatRipples.ts`，时计 `pendolo/pendoloBeatFx.ts`（不读重音，只看节奏过滤，见 Pendolo 一节），隐现 `backgrounds/latent/LatentBackground.tsx`。

每拍还带「重音」（`services/analysis/beatAccents.ts`，和拍点在同一次 final0 分析里从同一份梅尔频谱算出）：强度 0–1、低 / 中 / 高三段的占比、小节位置（从 beat_this 的重拍往后数），以及整首歌的动感系数（0.45–1，只降不升）。

- 时钟让每拍的峰值等于 `resolveBeatFxAccentGain`，即 (0.35 + 0.65 × 强度) × 动感系数，所以只读包络的画面（隐现）不用改代码就有强弱。
- 要按拍区分的，用 `getBeatFxLastBeat` / `getBeatFxLastDownbeat` 取刚发射的那一拍：
  - 商籁：偏低频的拍推近多一点，偏高频的拍横滚多一点，小节第 3 拍横滚减半（`resolveSonnetBeatFxAccent`）；
  - 镜台：涟漪强度乘以 gain，偏低频的普通拍用大尺度涟漪（`resolveDioramaBeatRipple`）。拍点涟漪本身比频段起音的涟漪强得多（普通拍 1.6、重拍 2.2，起音约 0.3–1），整体呼吸每拍 +20%、重拍 +28%，比关着时夸张；正在唱的那个字随拍跳起（拍点发射时正在唱的单元，落在字与字之间时取最近开始的那个），普通拍 1/4 行高、重拍 2/5 行高，随包络回落，换字也不打断（`resolveDioramaLyricHop`；每个单元的三层平面在 `DioramaActiveUnitPlanes` 里同一个 group 下）；只走拍点那条路，关着时不变。
- 复合拍子（6/8、9/8、12/8）里 Beat This! 数的是八分音符，比听感密三倍，慢歌也可能被数成双倍速，慢华尔兹按小节感受；重音里 `pulse` 为 0 的拍（只按重音位置认定，见 `services/analysis/README.md`）在 `mergeBeatFxEvents` 里就去掉了，所有画面只按附点四分音符的脉冲触发，小节位置也按留下的拍计。
- 没有节奏的小节（打击成分远低于全曲平常水平，例如只有喇叭的前奏）里，`resolveBeatFxAccentGain` 返回 0，所有画面这一段都不出拍点特效（`rhythmic`，见 `services/analysis/README.md`）。
- 没有重音数据时（旧存档，或读不到音频），以上各项都恰好等于 1，画面和加入重音之前一致。

### Lyrics pipeline

Visualizer 消费已解析的 `LyricData` / `Line` / `Word`，不负责解析 `.lrc`、`.vtt`、`.yrc` 或 `.qrc`。

- `src/utils/lyrics/parserCore.ts`：解析真源
- `src/utils/lyrics/renderHints.ts`：`getLineRenderHints`、`getLineRenderEndTime`、短句/快速 reveal
- `src/utils/lyrics/cjkSemanticLayout.ts`：CJK semantic grouping、sticky punctuation、display units
- `src/utils/lyrics/graphemeTiming.ts`：逐 grapheme timing
- `wordColoring.ts`：共享词高亮范围
- `src/utils/fontStacks.ts`：DOM、Canvas、pretext 和光栅化路径统一字重/字体栈
- `colorMix.ts`：主题色 alpha 与混合

`Line.fullText` 用于整句布局，`Line.words` 是 timing 真源；两者不保证简单拼接完全相等。重复词、空格、CJK 和标点不要用字符串搜索重新猜时间范围。

## Mode-specific navigation

### Still

`still/VisualizerStill.tsx`：静止的低占用模式，不挂载共享背景层（`still/entry.tsx` 的 `background: false`）。

### Classic

`classic/Visualizer.tsx`；逐词发光和它的时序与 Partita 共用：`GlowWord.tsx`、`glowWordTiming.ts`、`glowWordVariants.ts`。

### Cadenza / Fume

两者都属于测量和布局敏感模式：实现见 `cadenza/VisualizerCadenza.tsx`（RAF 渲染；测量与落点在 `cadenzaPreparedState.ts` / `cadenzaFragments.ts` / `cadenzaPlacements.ts`，时序包络在 `cadenzaEnvelopes.ts`）与 `fume/VisualizerFume.tsx`。代码使用 `@chenglou/pretext` 做文字准备/测量；Fume 还维护 article-level layout 与 cache。先查 `src/utils/lyrics/renderHints.ts` 和 `fontStacks.ts`，再改布局。

### Partita

完整的数据流说明见 [`partita/README.md`](partita/README.md)。快速定位：

- `VisualizerPartita.tsx`：sequential layout、缓存、预热、chunk/word 渲染；分栏布局与缓存在 `partitaLayout.ts`，chunk 组件在 `PartitaChunk.tsx`，逐词发光共用 `GlowWord.tsx`
- `src/utils/lyrics/cjkSemanticLayout.ts`：`buildPostLyricLayoutUnits`、`buildDisplayWordsFromLayoutUnits`
- `src/utils/lyrics/renderHints.ts`：行 transition / word reveal profile
- `PartitaChunk` / `PartitaWord`：行级与 display word 级动画

不要修改 `Line.words`；layout unit 和 display word 只应是 renderer 派生数据。

### Cappella

`cappella/VisualizerCappella.tsx` 负责群唱头像、聊天表情和歌词呈现：消息行与气泡在 `CappellaMessageRow.tsx` / `CappellaBubbleParts.tsx`，消息编排在 `cappellaMessages.ts`，逐字时序与测量在 `cappellaReveal.ts` / `cappellaBubbleMetrics.ts`。内置资源通过 `avatarImages.ts` / `emoImages.ts` 的 glob 载入；用户资源分别由 `src/services/cappellaAvatarPack.ts` 与 `cappellaEmojiPack.ts` 存入 IndexedDB。资源目录说明见 `cappella/avatar/README.md`、`cappella/emo/README.md`。

### Claddagh

`claddagh/VisualizerCladdagh.tsx` 使用 `buildLineGraphemeTimeline`、`pretext` 和有限 ring lines（环上一行是 `CladdaghRingLine.tsx`，时间线、布局与发光在 `claddaghTimeline.ts` / `claddaghLayout.ts` / `claddaghGlow.ts`）；音频响应/RAF 与 DOM 样式更新必须有界并在 cleanup 中释放。

### Monet

`monet/VisualizerMonet.tsx` 组合 `MonetLyricsRail`（歌词栏外壳与滚动；行与扫字在 `MonetRailLine.tsx` / `MonetRailTokens.tsx`，布局在 `monetRailLayout.ts`）、`AudioOverlay`、浮动装饰和背景 pipeline；图像资源还涉及 `src/services/monetBackgroundImage.ts`、`monetPortraitImage.ts`。混音过渡时：封面在过渡开始就换成下一首，淡入跟着交接进度（`MonetPortraitImage` 的 `progress`）；文字和歌词在交接过半（声音交叉点）时换，莫奈自己画的颜色（文字、装饰）同时换成下一首的主题，用原有的换歌入场动画，之后歌词栏读下一首自己的时钟和行（`monetSongHandoff.ts`）。

音频图案默认在底部；`audioPlacement: 'lyrics'` 将它移到歌词栏，保留歌曲信息和封面，并用上下对称的频谱替代该区域的歌词。位置由用户选择，不随歌词加载或间奏自动切换；关闭音频图案会恢复歌词栏。`audioGain`（0.5–2，默认 1）只调整画面响应。两项设置随 `visualizerTunings` 保存和分享。

### Diorama

`diorama/VisualizerDiorama.tsx` 进入 React Three Fiber 场景；场景/粒子/相机/文字光栅化分别看 `DioramaScene.tsx`（结构推导 `dioramaSceneLayout.ts`、每帧写入 `dioramaSceneFrame.ts`、邻行栅格缓存 `dioramaLineRasterCache.ts`、当前行单元平面 `DioramaActiveUnitPlanes.tsx`）、`dioramaParticle*.ts`、`cameraPath.ts`、`dioramaTextRaster.ts`。连续场景数据不要提升到 React state。

### Pendolo

`pendolo/VisualizerPendolo.tsx` 是 React 外壳；`PendoloClockworkCanvas.tsx` 负责时钟机械 canvas（优先 WebGL2：`pendoloClockworkWebGL.ts` 绘制、`pendoloClockworkMeshes.ts` 缓存齿轮几何、`pendoloClockworkMotion.ts` 推进摆动；不支持时退回 `pendoloClockworkDraw2d.ts` 的 Canvas2D；`pendoloClockworkScene.ts` 放共用的帧输入、配色与画布包围盒），`pendoloTextLayout.ts`、`pendoloTimeline.ts`、`pendoloGeometry.ts` 负责有界布局与时间线，`PendoloSettingsPanel.tsx` 负责调参。

智能动感模式下（`entry.tsx` 的 `beatEffects`：「仿真鼓面」读鼓点；「齿轮随拍」已搁置）：
- 用的拍子：beat_this 的拍点经「无节奏关」过滤（beat_this + HPSS，`rhythmic`），被关掉的拍什么都不触发。齿轮、火花、震屏不读重音，每拍满强度，只乘轻拍 / 重拍强度；冲击波（连同光晕、刻度和表盘点亮）和宝石闪光按重音强度（`resolveBeatFxAccentGain`，已含轻拍 / 重拍强度）。原来每拍扫一圈、点亮刻度的扫光已去掉。
- 机芯：大主齿轮和歌词照旧只跟歌词换行走，拍点不碰它们。主轮下方并排的传动齿轮和秒齿轮对着转：轻拍各走一齿，重拍各转一整圈，用略欠阻尼的弹簧，到位时冲过头不到一成再回弹（顿挫）。摆轮每拍换向。都在 `stepPendoloClockworkMotion` 的可选 `beat` 参数里，不传时与原来逐值一致（golden 单测锁定）；传动齿轮多转的角度是 `transBeatAngle`，关着时为 0。
- 特效：状态和触发在 `pendoloBeatFx.ts`（纯函数），每帧推进在 `usePendoloBeatFx.ts`，画法在 `pendoloBeatFxDraw.ts`。
  - 冲击波（轻拍、重拍都触发，强度跟重音）：透明的透镜，从轴心推到屏幕最远角，越往外越快（外角处约是出轴心时的五倍），一次走完用一拍的 85%，但在 0.3–0.5 秒之间（慢歌不会跟着变慢，只有快歌会更快），赶在下一拍的波从轴心重新出发前就出了表盘，推开（推出到轴心距离的 20% × 强度）、点亮并朝特效色染色经过的东西，不画任何环或线。齿轮上是 mesh shader 的 `u_wave` 位移、提亮和染色（Canvas2D 用 14 层切片重画），歌词行在 `PendoloRotatingLine` 里按到轴心的距离推开、提亮。摆轮上的主题图标（五角星）是 DOM，用 `resolvePendoloPointWave` 按 shader 同样的公式跟着摆轮移动。透镜本身不影响背景；同时 `VisualizerPendolo` 里有一层柔光晕（径向渐变，只有前沿一条软光带，后面是空的、扫过的地方立刻干净，边缘淡到 0，没有线；叠加混合），跟着冲击波从轴心长到屏幕最远角，扩散途中保持亮度，快到终点才淡出（`resolvePendoloHaloOpacity`）。强弱按分贝换算重音增益（`resolvePendoloWavePunch`：弱拍下限 0.35 比最强拍低 30 dB，亮度按指数变化，人眼看亮度近似对数，平方时中强拍看起来差不多；轻拍 / 重拍强度另外相乘）：弱拍的光晕淡、强拍满亮，都用同样的时间走到屏幕外角；表盘点亮的亮度也一样，放在震屏之外、齿轮和歌词之下。
    - 波峰经过刻度那圈表盘（1.15 倍轮半径）时 60 个刻度一起亮，经过最外圈表盘（1.4 倍）时整圈亮起，都随后淡出（`lightPendoloDials`，overlay 里画）。
  - 宝石闪光（各齿轮中心，轻拍、重拍都触发，强弱和光晕一样按重音增益的平方）：WebGL 是叠加混合的 overlay，Canvas2D 是 `lighter`。
  - 以下只在重拍上：咬合火花（同样画在 overlay 里；火花和两个齿轮转整圈同时喷出，数量、速度、大小是最早一版的）、8px 震屏。
- 颜色：主题强调色提亮到发光（`resolvePendoloBeatFxColor`），偏灰的主题用金色。
- 鼓点（效果「仿真鼓面」，`pendolo.drumhead`）：装了 `htdemucs_gpu` 时，时计在屏上就读这首歌的鼓点（`services/analysis/drumHits.ts`，GPU 分离鼓轨，一首约十几秒，存盘后不再跑；边分边给，开始后一秒左右就有）。读到后不再用拍点：底鼓、军鼓让光晕在原地按分贝曲线亮起再快速回落，宝石和两圈表盘一起亮；底鼓让整个表面鼓起，重的再震屏；军鼓打在偏离中心的位置，重的让表面朝那边倾；镲片点亮刻度和刻度所在的内圈（只亮刻度太不明显，2026-10-17 加上内圈）。没有冲击波、没有火花。读到之前、`until` 之后还没算到的地方、没装模型、没有 WebGPU，或没有鼓的歌，时计不出任何效果。强度滑杆乘在光晕、鼓起、倾斜、震屏和镲片点亮上（倾斜、震屏的门槛仍按原始鼓点强度判断），1× 与调好的样子逐值一致。
- 上面按拍点的那套效果（冲击波、光晕、火花、按拍震屏）已于 2026-10-17 废弃：代码保留，由 `usePendoloBeatFx.ts` 的 `PENDOLO_BEAT_LIST_FX` 关掉，不再运行。
- 机芯随拍（上面「机芯」一条，效果「齿轮随拍」，`pendolo.gearBeats`）同日搁置：登记为 `retired`，`PendoloClockworkCanvas.tsx` 只在它的强度大于 0 时把拍点交给齿轮，所以齿轮照原来的样子走，时计也不再为它跑 beat_this。
- 关闭或未就绪时，所有 MotionValue 为 0、shader 的 wave uniform 为 0、不画 overlay，画面与原来一致。

### Sonnet

`sonnet/VisualizerSonnet.tsx` 负责 React shell/subtitle，`createSonnetPixiRuntime.ts` 创建 Pixi runtime（只管生命周期、段落场景缓存、换歌溶解和每帧调度；shot 逐帧姿态 `sonnetShotFrame.ts`、场景转场选择 `sonnetSceneFrame.ts`、画框 `sonnetFrameOverlay.ts`、片尾模糊 `sonnetOutroBlur.ts`、主题图标纹理 `sonnetIconTextures.ts`）；其余 `sonnet*` 文件按 scene builder、shot flow、glyph/typography、post-process、resource pool 分工。注意 Pixi runtime、纹理和 RAF 的销毁。

### Tempera

完整说明见 [`tempera/README.md`](tempera/README.md)——编译期分镜、拼贴排版、逐字时序、网点图形语汇、文字反色 filter、渐变调色、片尾卡、画布图片池都在那里。快速定位：

- `tempera/VisualizerTempera.tsx`：React shell / subtitle；`createTemperaPixiRuntime.ts`：Pixi runtime（scene cache ±1、绝对时间驱动）
- `temperaProgram.ts` + `types.ts`：段落 / shot / slice 编译，121 种 shot kind
- `temperaLayout.ts` + `temperaMotion.ts`：拼贴排版与逐字入场求解
- `temperaDifferenceFilter.ts`：文字对背景逐像素反色，改动前务必先读那份说明里的约束
- Tempera 渲染层不消费音频（`audioPower`/`audioBands` 只传给共享背景层）。

### Lumiere

绘光：舞台光式的歌词 PV——体积光束、烟雾、线稿与浮尘组成的「图形组」，歌词按光束明暗点亮。快速定位：

- `lumiere/VisualizerLumiere.tsx`：React shell / subtitle；`createLumierePixiRuntime.ts`：Pixi runtime（WebGL only，建一次、换歌就地交接，scene cache ±1，一帧最多做一件贵的事）
- `lumiereProgram.ts` + `program.ts`：整首编译（段落首尾相接铺满时间轴、镜头、光位、段落转场）；纯音乐编译成只有间奏镜头的程序，不造 ♪ 虚拟行
- `scene.ts` / `lumiereUnit.ts`：一个段落一个场景，运镜在场景内部；运行时只在外面的 holder 上套转场帧（`lumiereSceneFrames.ts`：出场帧 + 边界后的交叉渐变，熄灯的变暗由场景自己的 fadeOut 完成）
- `lumiereSeamless.ts`：轨迹过渡（tuning `seamlessTransitions`，默认开）把按段落编好的程序并成整首一个单元——镜头 / 光位不变，段落之间也走光位交接，运镜按原段落往返推拉；它是编译选项（`LUMIERE_COMPILE_KEYS`），切换时重新编译、经同曲 swapSong 清场景缓存，不重建 WebGL。歌词窗口按需排版（只排当前行前后几行，见 `text/windowLines.ts`），所以整首一个单元建场景约 45–50 ms，与按段落相近；`lumiereUnitLayout.ts` 放领头光位 / 逐行排版 / 运镜这几个由镜头决定的纯函数
- `lumiereRuntimeTuning.ts`：用户 tuning → 场景 tuning、画质档（full / balanced / low 只降图形组 filter 分辨率、封顶烟雾倍频，文字保持满分辨率）、哪些改动要防抖重建场景
- `lumiereAudio.ts`：`audioBands.bass` / `treble` / `audioPower` 归一化到 0..1（主播放器 0..255、预览 0..1）并做起音 / 释放平滑；渲染层消费音频
- `lumiereCreditsLayer.ts` + `credits.ts`：片尾卡在最后一句唱完前几秒才建；`overlay.ts`：取景器画框
- `lumiereDarkField.ts`：暗场底（tuning `darkField`，浅色主题保底 0.94）是运行时铺在所有场景与片尾卡之下的一整块底，不随段落转场变化；光场着色器的 `uDark` 在 folia 里恒为 0
- 歌词字号由光位的文字区决定，通用字号设置只影响底部字幕

## Host surfaces

不要只在主播放器里验证 visualizer。统一 renderer 当前被这些宿主复用：

- `src/App.tsx`
- `src/components/modal/theme-park/ThemeParkPreview.tsx`（主题乐园 `src/components/modal/ThemePark.tsx` 的预览）
- `src/components/visualizer/window/VisPlayground.tsx`
- `src/components/obs/ObsBrowserSourceApp.tsx`
- `src/components/obs/ObsWebSourceApp.tsx`

这几处不经过 `VisualizerRenderer`，直接用 registry 的 `render` 画样式本身，要画背景时由样式自己的外壳画：

- 选择器里的小预览图（`preview/LyricStylePicture.tsx`）：不画背景和字幕。
- `src/mods/export/modExportPage.tsx`（mod 导出页）：自己做 `applyVisualizerTuning`；导出设置的 `backgroundMode` 是 `theme` 时画默认背景，是 `none` 时背景透明。
- 开发探针 `dev/probes/*.probe.tsx`。

宿主可以提供不同的 `staticMode`、背景、面板和字幕 props，但模式契约仍来自 `definition.ts`。

换样式的过渡（`styleTransition/`）只在用的人亲手换样式的宿主里放：`App.tsx` 和 `VisPlayground.tsx` 给 `VisualizerRenderer` 传 `animateStyleSwitch`，其余宿主直接换。过渡动的是背景里面的样式那一层，视频层和模组舞台图层（都在 `VisualizerBackdrop.tsx`）不动；静态模式和降低「界面微动效」时也直接换。过渡是柔焦（`styleTransition/softFocus.ts`）：旧样式放大一点、虚化退下，新样式从同样的虚化里落定。背景换了也放同一个过渡（`styleTransition/VisualizerBackgroundTransition.tsx`）：换背景种类、新样式画在另一种背景上（Still 不画背景）、播放页设成透明，都算换；同一种背景里的设置不算，背景原地重画。换歌也算，只要背景画的东西跟着歌变（背景 entry 的 `song`，见上面的背景一节）：新歌的那一份马上挂上但先不露面，退下的那一份照旧画旧歌的封面和种子。换样式和换背景在同一次渲染里开始，一起换时是一个过渡。两者共用 `styleTransition/layerTransition.ts`：同时最多挂两个，退下的那个等不到动画结束也会在稍后卸下。换样式时新样式马上挂上但先不露面，旧样式原样留着，等新样式画好第一帧（`styleTransition/firstFrame.ts`，见上面的“起步慢的样式”）再一起放过渡，最多等 `FIRST_FRAME_LIMIT_MS`；跟着这次换样式一起换的背景也等着；背景自己也等新的那一份准备好（同样用 `useFirstFrameDrawn`），最多等 `BACKGROUND_READY_LIMIT_MS`。等着和放过渡的时候，选择器的小图不开始做图也不开始动（`preview/pictureTurns.ts` 的 `holdTurns`）。

## Runtime guardrails

- 连续播放时间优先使用 MotionValue、ref、CSS/Motion、canvas 或 Pixi draw loop；不要每帧写 React state/store。
- React state 只保存当前行、播放状态、可见段落等离散变化；高频 `requestAnimationFrame`、`useMotionValueEvent`、`ResizeObserver` 必须有相等保护和 cleanup。
- 布局 cache key 要包含歌词内容、主题、最终字重、窗口尺寸和 mode tuning；字体测量和最终渲染必须使用同一 `resolveThemeFontWeight` 结果。
- 新模式应复用 `runtime.ts`、`registry.tsx`、`VisualizerShell.tsx`、共享 subtitle/harmony overlay 和 `entry.tsx` settings contract；接入步骤见上面的“加一个歌词动画样式”。
- 新功能若让单个模式文件继续明显膨胀，加载 `file-modularization` skill，把 layout、canvas/Pixi、tuning 和纯计算拆到同目录文件。

## Fast lookup

```powershell
rg -n "VisualizerRenderer|VisualizerSharedProps|VisualizerMode|import.meta.glob|applyVisualizerTuning" src/components/visualizer src/types.ts
rg -n "getLineRenderHints|getLineRenderEndTime|buildPostLyricLayoutUnits|buildLineGraphemeTimeline" src/components/visualizer src/utils/lyrics
rg -n "Pendolo|Sonnet|Tempera|Diorama|Pixi|Canvas|pretext" src/components/visualizer
```

先看命中的入口和相邻 helper；只有需要修改具体模式时才继续读取该模式目录。
