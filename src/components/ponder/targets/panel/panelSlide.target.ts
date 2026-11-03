import { useAppViewStore } from '../../../../stores/useAppViewStore';
import {
    PANEL_SLIDE_CLAMP_PX,
    PANEL_SLIDE_TRACK_BASE_PX,
    PANEL_SLIDE_TRIGGER_PX,
} from '../../../../utils/panelSlideGesture';
import type { PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/panel/panelSlide.target.ts
// 侧边面板切换按钮：一个看起来只是普通按钮、实际上还能向左滑的控件。
// 三个场景对应三条真实路径：鼠标左滑、触屏边缘热区、键盘 S。
//
// 锚点里只有 toggle 是量真实 DOM 的（连圆角一起量，所以骨架是个圆按钮而不是方块）。
// 滑轨虽然在 DOM 里，但常态 opacity-0、宽度写死，几何完全由按钮决定 ——
// 推导比查询稳，还不受它显隐状态影响。尺寸全部来自 utils/panelSlideGesture 的共享常量。
//
// 字幕时长按中文阅读速度给：一句十几个字，2.8~3.4 秒才读得完还有余裕，
// 短了会逼着人用 ← 倒回去重看。

const SLIDE_ANCHORS = {
    /** 真实按钮，48×48 圆形。 */
    toggle: {
        kind: 'dom',
        selector: '[data-testid="panel-toggle"] button',
        role: 'control',
        labelKey: 'ponder.anchors.panelSlide.toggle',
    },
    /** 滑轨：按钮向左扩一个按钮宽。 */
    track: {
        kind: 'derived',
        from: 'toggle',
        expand: { left: PANEL_SLIDE_TRACK_BASE_PX },
        role: 'rail',
        labelKey: 'ponder.anchors.panelSlide.track',
        // 滑轨包着按钮，两个标签都放上方会叠字。
        labelPlacement: 'below',
    },
    /** 滑轨左端那枚半透明 Command 图标。 */
    trackGlyph: {
        kind: 'derived',
        from: 'track',
        at: { anchor: 'track', x: 0, y: 0.5, offset: { x: 14 } },
        size: { width: 14, height: 14 },
        role: 'control',
    },
    /** 触发判定线：按钮中心左移一个触发阈值。 */
    threshold: {
        kind: 'derived',
        from: 'toggle',
        at: { anchor: 'toggle', x: 0.5, y: 0.5, offset: { x: -PANEL_SLIDE_TRIGGER_PX } },
        size: { width: 2, height: 56 },
        role: 'marker',
        // 不标名字：它和按钮、滑轨挤在同一小块地方，三个标签必然叠字。
        // 这根线是什么，由指着它的那句字幕讲。
    },
    /**
     * 命令面板此刻不在场，按视口比例合成。这个手柄在播放页上，那里有歌时控制条在，
     * 面板从控制条原地往上长 —— 所以画在下方、输入行在底。
     */
    palette: {
        kind: 'synthetic',
        rect: { left: 0.5, top: 0.48, width: 0.44, height: 0.44, anchorX: 'center' },
        role: 'surface',
        surfaceKind: 'capsule-palette',
        labelKey: 'ponder.anchors.panelSlide.palette',
        // 面板是滑动越线或按 S 之后才打开的，一进场就摆着的话字幕在讲一件已经发生的事。
        startsHidden: true,
    },
} satisfies PonderSceneScript['anchors'];

const slideToPalette: PonderSceneScript = {
    id: 'panel-slide-to-palette',
    titleKey: 'ponder.scenes.panelSlideToPalette',
    anchors: SLIDE_ANCHORS,
    steps: [
        { kind: 'highlight', id: 'revealTrack', anchor: 'track', intensity: [0, 0.5], durationMs: 460 },
        { kind: 'highlight', id: 'revealGlyph', anchor: 'trackGlyph', durationMs: 460, withPrevious: true },
        {
            kind: 'caption',
            id: 'intro',
            textKey: 'ponder.captions.panelSlide.intro',
            pointTo: { anchor: 'track' },
            durationMs: 3000,
            withPrevious: true,
        },
        { kind: 'pause', id: 'readIntro' },

        { kind: 'cursor', id: 'approach', from: { anchor: 'toggle', y: 3.2 }, to: { anchor: 'toggle' }, durationMs: 560, ease: 'outCubic' },
        { kind: 'cursor', id: 'grab', to: { anchor: 'toggle' }, press: 'down', durationMs: 200, keyframe: true },
        {
            kind: 'caption',
            id: 'grabbed',
            textKey: 'ponder.captions.panelSlide.grabbed',
            pointTo: { anchor: 'toggle' },
            durationMs: 2600,
            withPrevious: true,
        },
        { kind: 'pause', id: 'held' },

        // 拖动本体。轨道填充、判定线、字幕挂在同一段时间上 —— 三者同时发生才是这条手势的样子。
        { kind: 'drag', id: 'drag', from: { anchor: 'toggle' }, to: { anchor: 'toggle', offset: { x: -PANEL_SLIDE_CLAMP_PX } }, durationMs: 900, ease: 'outCubic', keyframe: true },
        { kind: 'highlight', id: 'trackFill', anchor: 'track', intensity: [0.5, 1], durationMs: 900, withPrevious: true },
        { kind: 'highlight', id: 'thresholdLine', anchor: 'threshold', intensity: [0, 1], durationMs: 900, withPrevious: true },
        {
            kind: 'caption',
            id: 'threshold',
            textKey: 'ponder.captions.panelSlide.threshold',
            pointTo: { anchor: 'threshold' },
            durationMs: 3400,
            withPrevious: true,
        },

        // 停在触发点上，让「36px 就够了，44px 只是夹紧上限」看得清。
        { kind: 'pause', id: 'atThreshold', dwellMs: 1600 },

        { kind: 'cursor', id: 'release', to: { anchor: 'toggle', offset: { x: -PANEL_SLIDE_CLAMP_PX } }, press: 'up', durationMs: 200 },
        { kind: 'reveal', id: 'paletteOpens', anchor: 'palette', transition: 'slide-up', durationMs: 460, keyframe: true },
        {
            kind: 'caption',
            id: 'outcome',
            textKey: 'ponder.captions.panelSlide.outcome',
            pointTo: { anchor: 'palette' },
            durationMs: 3000,
            withPrevious: true,
        },
        { kind: 'pause', id: 'settle' },
    ],
};

const touchEdgeHotspot: PonderSceneScript = {
    id: 'panel-slide-edge-hotspot',
    titleKey: 'ponder.scenes.panelSlideEdgeHotspot',
    anchors: SLIDE_ANCHORS,
    steps: [
        {
            kind: 'caption',
            id: 'intro',
            textKey: 'ponder.captions.panelSlide.hotspotIntro',
            pointTo: { anchor: 'toggle' },
            durationMs: 3000,
        },
        { kind: 'pause', id: 'readIntro' },
        { kind: 'cursor', id: 'tapEdge', from: { anchor: 'toggle', x: 4 }, to: { anchor: 'toggle', x: 1.2 }, press: 'tap', durationMs: 620, keyframe: true },
        { kind: 'highlight', id: 'trackAppears', anchor: 'track', intensity: [0, 0.8], durationMs: 420 },
        {
            kind: 'caption',
            id: 'revealed',
            textKey: 'ponder.captions.panelSlide.hotspotRevealed',
            pointTo: { anchor: 'track' },
            durationMs: 3200,
            withPrevious: true,
        },
        { kind: 'pause', id: 'settle' },
    ],
};

const keyboardShortcut: PonderSceneScript = {
    id: 'panel-slide-keyboard',
    titleKey: 'ponder.scenes.panelSlideKeyboard',
    anchors: SLIDE_ANCHORS,
    steps: [
        { kind: 'caption', id: 'intro', textKey: 'ponder.captions.panelSlide.keyboardIntro', durationMs: 2400 },
        { kind: 'pause', id: 'readIntro' },
        { kind: 'keypress', id: 'pressS', keys: ['Mod K'], at: 'bottom', durationMs: 1400, keyframe: true },
        { kind: 'reveal', id: 'paletteOpens', anchor: 'palette', transition: 'slide-up', durationMs: 460 },
        {
            kind: 'caption',
            id: 'outcome',
            textKey: 'ponder.captions.panelSlide.keyboardOutcome',
            pointTo: { anchor: 'palette' },
            durationMs: 3000,
            withPrevious: true,
        },
        { kind: 'pause', id: 'settle' },
    ],
};

export default {
    id: 'panel-slide',
    titleKey: 'ponder.targets.panelSlide',
    category: 'playback',
    summaryKey: 'ponder.summaries.panel_slide',
    hoverSelector: '[data-testid="panel-toggle"]',
    // canSlideOpenCommandPalette = !isOpen && ...（UnifiedPanel.tsx:300）。
    // 面板展开时这条手势本身是关的，此时教它等于教一个按不动的东西。
    isAvailable: () => !useAppViewStore.getState().isPanelOpen,
    scenes: [slideToPalette, touchEdgeHotspot, keyboardShortcut],
} satisfies PonderTargetDefinition;
