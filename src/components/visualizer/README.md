# Visualizer 开发说明

这个目录放的是播放页歌词可视化相关组件。

当前已有实现：

- `Visualizer.tsx`: 经典流光模式
- `VisualizerCadenza.tsx`: 心象模式
- `VisualizerPartita.tsx`: 云阶模式
- `VisualizerFume.tsx`: 浮名模式
- `VisualizerShell.tsx`: 共享外层容器、背景层、返回按钮
- `VisualizerSubtitleOverlay.tsx`: 共享底部翻译 / 下一句提示层
- `runtime.ts`: 共享 runtime 工具与基础 hook（当前行、下一句、最近完成句、预热入口）
- `GeometricBackground.tsx`: 通用几何背景
- `FumeBackground.ts`: Fume 专用 canvas 几何背景
- `FluidBackground.tsx`: 封面取色流体背景
- `VisPlayground.tsx`: 可视化预览和样式设置面板

## 目标

实现一个新的 visualizer 时，需要保证它可以同时在下面两个场景里工作：

1. 播放页实际渲染，由 `src/App.tsx` 调用
2. 预览面板渲染，由 `VisPlayground.tsx` 调用

这意味着新组件不能只“能显示”，还要遵守现有调用约定。

## 必须遵守的组件契约

当前目录下的 visualizer 没有统一抽成共享 TypeScript 接口，但已经形成了一套事实标准。新实现建议直接兼容下面这组 props。

```tsx
interface VisualizerProps {
    currentTime: MotionValue<number>;
    currentLineIndex: number;
    lines: Line[];
    theme: Theme;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    showText?: boolean;
    coverUrl?: string | null;
    useCoverColorBg?: boolean;
    seed?: string | number;
    backgroundOpacity?: number;
    lyricsFontScale?: number;
    onBack?: () => void;
}
```

组件导出形式也保持一致：

```tsx
const VisualizerFoo: React.FC<VisualizerProps & { staticMode?: boolean; }> = (props) => {
    // ...
};

export default VisualizerFoo;
```

如果你的 visualizer 需要独有调参，也沿用现有模式，增加可选 props，例如：

- `cadenzaTuning?: CadenzaTuning`
- `partitaTuning?: PartitaTuning`
- `fumeTuning?: FumeTuning`

不要把必须由外部传入的运行时配置写死在组件常量里，除非它确实不需要进入设置面板。

## 每个 props 的职责

### 核心时间与歌词数据

- `currentTime`: 当前播放时间的 `MotionValue<number>`，单位秒。推荐通过 `currentTime.get()` 读取当前值，或通过 `useMotionValueEvent` 监听变化。
- `currentLineIndex`: 当前激活歌词行索引。可能为 `-1`，表示当前没有激活行。
- `lines`: 已处理好的歌词行数组。新 visualizer 应假定这里的数据已经可直接渲染，不再负责拉取或解析歌词。

### 主题与音频输入

- `theme`: 当前歌词主题。包含颜色、字体风格、动画强度等。
- `audioPower`: 音频整体能量。
- `audioBands`: 分频能量，用于驱动背景或局部动画。

### 展示控制

- `showText`: 是否显示歌词文字。预览和播放器里都可能传入。
- `coverUrl`: 封面 URL，主要给 `FluidBackground` 使用。
- `useCoverColorBg`: 是否启用封面取色背景。
- `backgroundOpacity`: 当启用封面背景时，叠加底色的透明度。
- `lyricsFontScale`: 用户字号缩放。新 visualizer 应把它乘进最终字号，而不是忽略。
- `staticMode`: 静态模式。约定为“禁用重资源背景动画”，不是关闭全部歌词动画。
- `onBack`: 返回按钮回调。播放器全屏/主视图里会用到。
- `seed`: 背景或布局随机种子，保证同一歌曲下布局尽量稳定。

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

## 当前模块化架构

当前目录已经开始按“共享基座 + 各自 renderer”组织，而不是每个 visualizer 都各写一整棵树。

### 1. 共享壳层

- `VisualizerShell.tsx`
  负责：
  - 根容器
  - 返回按钮显隐与点击
  - `FluidBackground`
  - 背景底色
  - `GeometricBackground`
  - 按 renderer 需要关闭默认几何背景
  - `staticMode` / `useCoverColorBg` / `backgroundOpacity` 这些通用外层行为

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

- `Visualizer.tsx`
  DOM + Framer Motion 的自由散点词布局
- `VisualizerPartita.tsx`
  DOM + Framer Motion 的分列 / 分块布局
- `VisualizerCadenza.tsx`
  canvas + DOM overlay 的重型排版 / 动画引擎

不要把这三种 renderer 强行揉成一个统一组件。共享的是壳层、runtime、字幕层、预热入口，不是具体渲染算法。

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

## 预热与缓存

当前架构把“预热入口”收敛到了共享 runtime 层，但缓存内容仍然由各 renderer 自己决定。

### 已有模式

- `VisualizerPartita.tsx`
  使用布局缓存，并在进入时间窗口时预热下一句布局
- `VisualizerCadenza.tsx`
  使用更重的 prepared-state 缓存，并在计算当前句时顺手准备 upcoming line
- `Visualizer.tsx`
  当前没有专门的重型预热层，保持即时布局计算

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

```tsx
import React from 'react';
import { MotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Line, Theme, AudioBands } from '../../types';
import { getLineRenderEndTime } from '../../utils/lyrics/renderHints';
import { useVisualizerRuntime } from './runtime';
import VisualizerShell from './VisualizerShell';
import VisualizerSubtitleOverlay from './VisualizerSubtitleOverlay';

interface VisualizerFooProps {
    currentTime: MotionValue<number>;
    currentLineIndex: number;
    lines: Line[];
    theme: Theme;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    showText?: boolean;
    coverUrl?: string | null;
    useCoverColorBg?: boolean;
    seed?: string | number;
    backgroundOpacity?: number;
    lyricsFontScale?: number;
    onBack?: () => void;
}

const VisualizerFoo: React.FC<VisualizerFooProps & { staticMode?: boolean; }> = ({
    currentTime,
    currentLineIndex,
    lines,
    theme,
    audioPower,
    audioBands,
    showText = true,
    coverUrl,
    useCoverColorBg = false,
    seed,
    staticMode = false,
    backgroundOpacity = 0.75,
    lyricsFontScale = 1,
    onBack,
}) => {
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
            coverUrl={coverUrl}
            useCoverColorBg={useCoverColorBg}
            seed={seed}
            staticMode={staticMode}
            backgroundOpacity={backgroundOpacity}
            onBack={onBack}
        >
            <div className="relative z-10 w-full h-[70vh] flex items-center justify-center p-8 pointer-events-none">
                {showText && activeLine ? (
                    <div>{activeLine.fullText}</div>
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
            />
        </VisualizerShell>
    );
};

export default VisualizerFoo;
```

## 接入一个新 visualizer 需要修改的文件

实现组件本身之后，通常还要接下面几个点。

### 1. `src/types.ts`

如果是一个全新的模式：

- 给 `VisualizerMode` 增加新枚举值

如果有专属调参：

- 新增 `FooTuning`
- 新增 `DEFAULT_FOO_TUNING`

### 2. `src/hooks/useAppPreferences.ts`

如果新模式需要用户可调参数：

- 读取本地存储
- 提供 `handleSetFooTuning`
- 提供 `handleResetFooTuning`

### 3. `src/App.tsx`

播放器实际渲染入口在这里。需要：

- import 新组件
- 在 visualizer 分支里接入新组件
- 把专属 tuning 透传下去

### 4. `src/components/visualizer/VisPlayground.tsx`

预览面板入口在这里。需要：

- import 新组件
- 增加模式分支
- 增加预览调参 UI
- 把字体缩放和独有 tuning 一起传进去

### 5. `src/components/modal/HelpModal.tsx`

如果设置面板需要打开预览器，通常这里也要透传新的 tuning props 到 `VisPlayground`。

### 6. `src/components/Home.tsx`

如果 `HelpModal` 的 props 发生变化，这里通常也要同步透传。

### 7. 文案文件

至少同步：

- `src/i18n/locales/zh-CN.ts`
- `src/i18n/locales/en.ts`

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
- 在 `App.tsx` 和 `VisPlayground.tsx` 传入

### 4. 尽量保持背景层行为一致

建议继续复用：

- `FluidBackground`
- `GeometricBackground`
- 左上返回按钮交互

这样不同模式切换时，用户不会感觉整套播放器逻辑被打散。

### 5. 预览和实际播放必须一致

`VisPlayground` 不应该使用和播放器完全不同的一套参数解释方式。预览应尽量复用真实组件，而不是复制一个“假实现”。

## 自检清单

新增一个 visualizer 后，提交前至少检查下面几项：

- 是否默认导出组件
- 是否兼容 `VisualizerProps & { staticMode?: boolean }`
- 是否处理 `activeLine` 不存在的情况
- 是否支持 `showText = false`
- 是否正确使用 `lyricsFontScale`
- 是否在 `staticMode` 下关闭重背景动画
- 是否已经接入 `App.tsx`
- 是否已经接入 `VisPlayground.tsx`
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
