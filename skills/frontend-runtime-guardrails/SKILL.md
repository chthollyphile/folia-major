---
name: frontend-runtime-guardrails
description: Use when adding, refactoring, or reviewing frontend runtime behavior in this repository, especially visualizers, lyrics animation, Framer Motion usage, useMotionValueEvent, requestAnimationFrame, ResizeObserver, high CPU reports, jank, per-character or per-frame animation, React state update frequency, and performance-sensitive UI paths.
---

# Frontend Runtime Guardrails

## Purpose

这个 skill 用于在前端运行时敏感路径中保持低 CPU、低重渲染和稳定时序，尤其是歌词 visualizer、全屏播放、预览面板和动画密集组件。

核心目标：

- 区分“离散 UI 状态”和“逐帧运动数据”
- 复用现有 visualizer 的运行时模式
- 保持歌词时序、排版和动画之间的边界清晰
- 在代码进入 React render path 前检查性能风险

## First Pass

开始写或审查前，先快速定位这次改动属于哪类路径：

- 普通 UI 状态：可以用 `useState`，但仍要避免无意义重复更新。
- 歌词时序状态：优先使用离散状态，例如 `waiting | active | passed`。
- 播放中连续变化的运动值：优先使用 Framer Motion variants、MotionValue、CSS transition/keyframes、`useRef`、canvas 或 DOM 同步。
- 布局测量和缓存：优先使用 `useMemo`、`useRef`、`ResizeObserver`，并做缓存 key、尺寸变化和清理保护。
- 歌词解析、分词、时序映射：优先从 `types.ts`、`utils/lyrics/parserCore.ts` 和已有 lyrics utilities 理解数据真源。

## 规则

### React State

高频路径里不要无条件 `setState`：

- `useMotionValueEvent(currentTime, 'change', ...)`
- `requestAnimationFrame` callback
- `ResizeObserver` callback
- audio analyser / playback polling callback
- pointer move / scroll / resize 高频事件

“当前精确时间”不进 React state：`currentTime.get()`、`audio.currentTime`、RAF 时间戳、MotionValue 的每次变化都不写进 `useState` 或 store 来驱动歌词、进度、逐字强度或动画相位，因为那会让整棵歌词树每帧重渲染。连续时间用现有方案：`MotionValue` / `useTransform` / CSS 或 Framer Motion 动画 / canvas draw loop / `useRef` 保存瞬时值；只有当前行、播放状态、可见段落这类离散变化进 React state。

如果必须在高频回调里更新 React state，必须满足至少一条：

- 只更新离散状态，并先比较新旧值，例如 `current === next ? current : next`
- 限流到明确的低频节奏
- 只在可见、active、mounted 且确实变化时更新
- 更新的是少量稳定标量，而不是按字、按词、按像素展开的数组或对象

不要把每帧变化的 `scale`、`opacity`、`transform`、坐标、逐字符强度数组放进 `useState`。这些更适合由 MotionValue、CSS、Framer Motion variants、canvas draw loop，或 `useRef` 驱动的非 React 渲染层处理。

### Visualizer Patterns

优先参考现有模式：

- `classic` / `partita`：每个词只持有 `waiting | active | passed` 这种粗粒度状态，状态变化时才 `setState`；入口都经过 `src/components/visualizer/registry.tsx`。
- `cappella`：字符数量和时间戳可进入 state，但 setter 需要做相等保护，只在计数真正变化时更新。
- `cadenza` / `fume`：重动画和高频渲染使用 refs、缓存、canvas、DOM overlay、RAF draw loop，而不是逐帧 React rerender。
- `claddagh`：用 `buildLineGraphemeTimeline` 保留逐字时间，使用 `pretext` 做字符间距测量，并在 `useLayoutEffect` 中直接写入有限数量 ring line 的 DOM 样式；中心线的音频响应由独立 RAF 驱动，必须清理订阅和 RAF。
- `diorama`：React Three Fiber / canvas 场景负责粒子、相机和光栅化文字；不要把每帧场景数据提升到 React state。
- `pendolo`：`PendoloClockworkCanvas`、timeline 和 bounded text layout 负责连续动画；React 只保留 tuning 与离散歌词切换。
- `sonnet`：`VisualizerSonnet` 负责 React 外壳，`createSonnetPixiRuntime` 与 `sonnet*` helpers 负责 Pixi director；销毁 Pixi runtime、纹理池和 RAF。
- `VisPlayground`：预览时间可以推进 MotionValue，但派生到 React state 时必须只更新当前行等低频状态。

共享运行时边界是 `VisualizerRenderer.tsx` -> `runtime.ts` / `registry.tsx` / `VisualizerShell.tsx`；它同时被 App、ThemePark、VisPlayground 和 OBS source 复用（宿主清单见 `src/components/visualizer/README.md` 的 Host surfaces）。新增模式应沿 `entry.tsx` registry 接入，不要在各宿主复制渲染分支。

歌词和字幕的字重统一用 `resolveThemeFontWeight(theme, modeFallback)`，规则见 `reuse-project-utilities` 的 Font Stacks 一节。

新增 visualizer 时，先决定：

- 这段动画是入场/离场动画，还是播放期间持续动画？
- 它需要 React 参与渲染吗，还是可以由 CSS/Motion/canvas 自己完成？
- 当前实现的每秒 React 更新次数大概是多少？
- 长歌词、重复歌词、CJK grapheme、移动端和 Electron 下是否仍然可接受？

### Lyrics Timing

歌词显示文本、布局单元和 `Line.words` 时序是三层不同数据。不要在 visualizer 里临时猜测它们之间的关系。

### Visualizer Lyrics Contract

写 visualizer 时，把输入视为已经整理好的统一歌词对象，而不是原始歌词文本：

- renderer 接收的是 `LyricData` / `Line` / `Word`，不直接处理 `.lrc`、`.vtt`、`yrc`、`qrc`。
- 不要把格式识别、翻译对齐、纯音乐判断、来源 adapter 逻辑塞回 visualizer。
- `Line` 是渲染最常用的单位；`Word` 是最小时间单位；`LyricData` 是整首歌。
- `currentLineIndex` 可能是 `-1`，`lines[currentLineIndex]` 可能不存在。
- `translation` 已经按行对齐，可能为空；底部字幕和下一句提示交给共享 overlay 处理。

处理 `fullText` 和 `words` 时要记住：

- `fullText` 更接近整句展示文本，适合做整句布局。
- `words` 是歌词流水线产出的时间片段，粒度依来源和内容变化。
- `fullText` 不保证等于 `words.map(word => word.text).join('')`；空格、标点和 display text 可能不完全对齐。
- 标点很多时候会作为独立 `Word` 出现，需要 renderer 决定合并、跳过或特殊动画。
- 拉丁文本可能以整词进入 `Word`，例如英文或法文单词；字母级动画应在 renderer 内部基于 `word.text` 再拆分。
- 英文 contraction 或 sticky punctuation 可能需要用 `buildPostLyricLayoutUnits` / `buildDisplayWordsFromLayoutUnits`，不要临时手写拼接规则。

处理 `renderHints` 时要记住：

- `renderHints` 是 visualizer 运行时契约的一部分，尤其影响短句、极短句、逐字 reveal、尾迹和退场。
- `line.endTime` 是安全边界：到达这里前，歌词主体必须已经展示完成；需要退场的模式也应默认能在这里完成或进入可截断状态。
- `renderHints.renderEndTime` 只是给尾迹、残影、退场特效的额外延长可能性，不是稳定可用时间。
- 大多数播放场景会在 `line.endTime` 或下一句开始时直接切到下一句；不要把核心 reveal、排版进入、关键信息展示依赖到 `renderEndTime` 之后。
- 需要清理尾迹或判断“最晚还可保留多久”时，才使用 `getLineRenderEndTime(line)`。

处理 segment/layout unit 到 words 的映射时，优先保留或计算明确范围：

- 从分割函数返回 segment 的 `startOffset` / `endOffset`
- 按前序 segment 累积 cursor
- 用原始 `Line.words` 的字符范围做映射
- 对重复词、CJK、标点、空格和长句添加单测

任何歌词分割都必须保证：

- `segments.map(s => s.text).join('') === fullText`
- 空格、标点、CJK grapheme 不被意外丢失
- 重复片段不会复用错误时间
- parser 的词级 timing 仍然是动画时序真源

### Layout And Measurement

- 布局缓存的 key 要包含影响布局的主题、字体、最终字重、尺寸、tuning 和歌词内容；漏一项就会复用旧布局。
- 长文本测量和分词结果不在 render 里反复重算。
- 文字测量用 pretext，测量结构要和真实渲染结构一致，坑见 `reuse-project-utilities` 的 Text Layout And Measurement。

### Module Boundaries

遵守仓库职责边界；如果需要 README 背景，按 `readme-reference` 只读取相关片段：

- visualizer 共享逻辑放 `components/visualizer/*` 的 runtime、registry、shell 或相邻 util。
- 一个模式的全部代码（entry、tuning、设置面板、渲染器、layout、只给它用的纯函数）放 `components/visualizer/<mode>/`。当前有哪些模式看 `src/types/visualizerModes.ts` 的 `BUILTIN_VISUALIZER_MODES`，这里不抄清单。加一个模式的完整步骤见 `src/components/visualizer/README.md` 的“加一个歌词动画样式”。
- 背景实现放 `components/visualizer/backgrounds/<name>/`，清单是同一文件的 `BUILTIN_VISUALIZER_BACKGROUND_MODES`。
- 歌词解析真源看 `utils/lyrics/parserCore.ts`。
- 纯分词、layout、时序映射：只给一个模式用的放在那个模式的目录里；两个以上模式用到才放 `utils/lyrics/*`。都用单测覆盖。
- 共享类型先看 `types.ts`。
- 不要把新 visualizer 的设置、runtime、layout、测试辅助全部堆进单个超大组件；按 `file-modularization` 在模式目录里拆成几个文件。

## Review Checklist

审查或实现性能敏感前端改动时，至少检查这些问题：

- 是否存在高频回调里的无条件 `setState`？
- 是否把当前精确播放时间、RAF 时间戳或 MotionValue 的连续值写进 React state / store？
- 是否每帧创建新数组、新对象并进入 React state？
- 是否每个字符、每个词、每个 segment 都各自订阅同一个 MotionValue？
- `claddagh` 是否仍只渲染中心行附近的有限 ring line，字符测量是否命中有界缓存？
- 不可见或 inactive 元素是否仍在持续更新？
- 动画能否改成 CSS/Motion/canvas 驱动，而不是 React rerender？
- 重复文本、CJK、多空格和标点是否有测试？
- 单测通过是否只是放宽断言，而不是验证了目标行为？
- 变更是否需要 UI 截图测试或手动性能观察，而不只是 unit test？
- 新增缓存是否有失效条件，旧 DOM/canvas 节点是否会被清理？
- 歌词和字幕的字重是否走 `resolveThemeFontWeight`，没有用 `font-bold`、固定 `fontWeight` 覆盖用户设置？
- 是否用字符串搜索推断歌词时序范围，却没处理重复文本和 offset？
- 新功能是否让已经很大的 visualizer 文件继续膨胀，而没有拆出 layout / util / hook？
- 新增 visualizer 是否遵守 registry、runtime、shell、subtitle overlay 的既有结构？

## Validation

按风险选择最小验证：

- 纯歌词分割、时序映射、layout util：跑相关 Vitest 单测。
- visualizer 交互、样式、截图回归：按 `testing-strategy` 判断是否跑 Playwright UI。
- CPU、jank、逐帧动画：优先解释更新路径，并建议用浏览器 Performance 或 Electron 实测确认。
- 不要为了 visualizer 小改默认跑完整 build，见 `testing-strategy`。
