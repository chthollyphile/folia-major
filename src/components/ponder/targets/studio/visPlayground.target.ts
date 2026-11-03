import { VIS_PLAYGROUND_GEOMETRY as G } from '../../surfaces/studio/visPlayground.geometry';
import { settingsPanel, settingsRegion } from '../settings/settingsSectionShared';
import type { PonderAnchorSource, PonderRelativeRect, PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/studio/visPlayground.target.ts
// 歌词样式窗口：设置 · 外观「歌词动画」那一行打开的窗口。
//
// 最藏的是预览上那三块热区。它们是三颗铺满一整条的透明按钮，没有描边、没有底色、
// 没有任何提示，指针压上去才描边并浮出一枚标签；点一下右栏就跳到对应那一页。
// 不悬停的话，一个人可以把这一屏用完而完全不知道它们存在 —— 而这恰恰是这一屏
// 设计上最快的那条路。
//
// 其余几章走一遍样式在哪选、右栏那四页各管什么：歌词动画（所选样式自己的参数）、背景、
// 通用（预览文本与歌词字体）、字幕。刻意不列具体有哪些样式 —— 那是一份会长的清单，
// 而且翻一遍就看见了，教程该讲的是「这一页管的是哪一类东西、哪些行有前提」。

/** 预览里的一块：几何相对预览本身。 */
const previewRegion = (rect: PonderRelativeRect, labelKey: string): PonderAnchorSource => (
    { kind: 'relative', from: 'preview', rect, role: 'region', labelKey }
);

/** 右栏里的一块：几何相对那条设置栏。 */
const panelPart = (rect: PonderRelativeRect, labelKey: string): PonderAnchorSource => (
    { kind: 'relative', from: 'settingsPanel', rect, role: 'region', labelKey }
);

const anchors = {
    panel: settingsPanel('vis-playground', 'ponder.anchors.visPlayground.panel', { top: 0.5, width: 0.92, height: 0.9 }),
    header: settingsRegion(G.header, 'ponder.anchors.visPlayground.header'),
    preview: settingsRegion(G.preview, 'ponder.anchors.visPlayground.preview'),
    hotspotBackground: previewRegion(G.hotspotBackground, 'ponder.anchors.visPlayground.hotspotBackground'),
    hotspotVisualizer: previewRegion(G.hotspotVisualizer, 'ponder.anchors.visPlayground.hotspotVisualizer'),
    hotspotSubtitle: previewRegion(G.hotspotSubtitle, 'ponder.anchors.visPlayground.hotspotSubtitle'),
    pause: previewRegion(G.pause, 'ponder.anchors.visPlayground.pause'),
    shelf: settingsRegion(G.shelf, 'ponder.anchors.visPlayground.shelf'),
    settingsPanel: settingsRegion(G.panel, 'ponder.anchors.visPlayground.settingsPanel'),
    tabs: panelPart(G.tabs, 'ponder.anchors.visPlayground.tabs'),
    tabCommon: panelPart(G.tabCommon, 'ponder.anchors.visPlayground.tabCommon'),
    sectionReset: panelPart(G.panelReset, 'ponder.anchors.visPlayground.sectionReset'),
    rows: panelPart(G.rows, 'ponder.anchors.visPlayground.rows'),
    backgroundPictures: panelPart(G.backgroundPictures, 'ponder.anchors.visPlayground.backgroundPictures'),
    rowOne: panelPart(G.rowOne, 'ponder.anchors.visPlayground.rowOne'),
    rowTwo: panelPart(G.rowTwo, 'ponder.anchors.visPlayground.rowTwo'),
    rowThree: panelPart(G.rowThree, 'ponder.anchors.visPlayground.rowThree'),
    rowFour: panelPart(G.rowFour, 'ponder.anchors.visPlayground.rowFour'),
    rowFive: panelPart(G.rowFive, 'ponder.anchors.visPlayground.rowFive'),
    // 「字幕」页最下面那一组：继承歌词字体、字幕缩放。
    subtitleFollowsFont: panelPart(G.rowEight, 'ponder.anchors.visPlayground.subtitleFont'),
    subtitleScale: panelPart(G.rowNine, 'ponder.anchors.visPlayground.subtitleFont'),
} satisfies Record<string, PonderAnchorSource>;

/** 第一章：左预览右设置栏，以及左边那块是真的在跑。 */
const layout: PonderSceneScript = {
    id: 'vis-playground-layout',
    titleKey: 'ponder.scenes.visPlaygroundLayout',
    action: {
        kind: 'openSettings',
        anchorId: 'lyricsRenderer',
        labelKey: 'ponder.actions.openLyricsAnimation',
    },
    anchors,
    steps: [
        { kind: 'highlight', id: 'markPreview', anchor: 'preview', intensity: [0, 0.7], durationMs: 460, keyframe: true },
        {
            kind: 'caption', id: 'preview',
            textKey: 'ponder.captions.visPlayground.preview',
            pointTo: { anchor: 'preview' }, durationMs: 6200, withPrevious: true,
        },
        { kind: 'pause', id: 'readPreview' },

        { kind: 'highlight', id: 'dimPreview', anchor: 'preview', intensity: [0.7, 0], durationMs: 380, keyframe: true },
        { kind: 'highlight', id: 'markPause', anchor: 'pause', intensity: [0, 0.95], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'pause',
            textKey: 'ponder.captions.visPlayground.pause',
            pointTo: { anchor: 'pause' }, durationMs: 5800, withPrevious: true,
        },
        { kind: 'pause', id: 'readPause' },
    ],
};

/** 第二章：那三块看不见的热区。整个目标的理由。 */
const hotspots: PonderSceneScript = {
    id: 'vis-playground-hotspots',
    titleKey: 'ponder.scenes.visPlaygroundHotspots',
    anchors,
    steps: [
        {
            kind: 'caption', id: 'invisible',
            textKey: 'ponder.captions.visPlayground.invisible',
            pointTo: { anchor: 'preview' }, durationMs: 6600, keyframe: true,
        },
        { kind: 'pause', id: 'readInvisible' },

        // 指针移过去，边框才长出来。这一步演的就是「不悬停永远发现不了」。
        { kind: 'cursor', id: 'hoverMiddle', to: { anchor: 'hotspotVisualizer' }, durationMs: 760, keyframe: true },
        { kind: 'surfaceState', id: 'revealHotspots', anchor: 'panel', state: 'hotspots-visible', durationMs: 460, withPrevious: true },
        {
            kind: 'caption', id: 'three',
            textKey: 'ponder.captions.visPlayground.three',
            pointTo: { anchor: 'hotspotVisualizer' }, durationMs: 7200, withPrevious: true,
        },
        { kind: 'pause', id: 'readThree' },

        { kind: 'cursor', id: 'clickMiddle', to: { anchor: 'hotspotVisualizer', y: 0.4 }, press: 'tap', durationMs: 620, keyframe: true },
        { kind: 'highlight', id: 'markTabs', anchor: 'tabs', intensity: [0, 0.9], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'jumps',
            textKey: 'ponder.captions.visPlayground.jumps',
            pointTo: { anchor: 'tabs' }, durationMs: 6400, withPrevious: true,
        },
        { kind: 'pause', id: 'readJumps' },
    ],
};

/** 第三章：右栏四页，以及「通用」那一页 —— 它没有热区，只能从标签进。 */
const commonSection: PonderSceneScript = {
    id: 'vis-playground-common',
    titleKey: 'ponder.scenes.visPlaygroundCommon',
    anchors,
    steps: [
        { kind: 'highlight', id: 'markStrip', anchor: 'tabs', intensity: [0, 0.85], durationMs: 460, keyframe: true },
        {
            kind: 'caption', id: 'four',
            textKey: 'ponder.captions.visPlayground.four',
            pointTo: { anchor: 'tabs' }, durationMs: 6200, withPrevious: true,
        },
        { kind: 'pause', id: 'readFour' },

        { kind: 'highlight', id: 'dimStrip', anchor: 'tabs', intensity: [0.85, 0], durationMs: 360, keyframe: true },
        { kind: 'surfaceState', id: 'toCommon', anchor: 'panel', state: 'section-common', durationMs: 480, withPrevious: true },
        { kind: 'highlight', id: 'markCommon', anchor: 'tabCommon', intensity: [0, 0.95], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'common',
            textKey: 'ponder.captions.visPlayground.common',
            pointTo: { anchor: 'tabCommon' }, durationMs: 6600, withPrevious: true,
        },
        { kind: 'pause', id: 'readCommon' },

        // 字体、字号、自动字重三行。
        { kind: 'highlight', id: 'dimCommon', anchor: 'tabCommon', intensity: [0.95, 0], durationMs: 360, keyframe: true },
        { kind: 'highlight', id: 'markFont', anchor: 'rowTwo', intensity: [0, 0.9], durationMs: 440, withPrevious: true },
        { kind: 'highlight', id: 'markSize', anchor: 'rowThree', intensity: [0, 0.9], durationMs: 440, withPrevious: true },
        { kind: 'highlight', id: 'markWeight', anchor: 'rowFour', intensity: [0, 0.9], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'fonts',
            textKey: 'ponder.captions.visPlayground.fonts',
            pointTo: { anchor: 'rowTwo' }, durationMs: 7000, withPrevious: true,
        },
        { kind: 'pause', id: 'readFonts' },

        { kind: 'highlight', id: 'dimFont', anchor: 'rowTwo', intensity: [0.9, 0], durationMs: 340, keyframe: true },
        { kind: 'highlight', id: 'dimSize', anchor: 'rowThree', intensity: [0.9, 0], durationMs: 340, withPrevious: true },
        { kind: 'highlight', id: 'dimWeight', anchor: 'rowFour', intensity: [0.9, 0], durationMs: 340, withPrevious: true },
        { kind: 'highlight', id: 'markPreviewText', anchor: 'rowOne', intensity: [0, 0.95], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'previewText',
            textKey: 'ponder.captions.visPlayground.previewText',
            pointTo: { anchor: 'rowOne' }, durationMs: 6200, withPrevious: true,
        },
        { kind: 'pause', id: 'readPreviewText' },

        // 标签行右端那颗「默认」是最容易看错的一处：它退的只是当前这一页。
        { kind: 'highlight', id: 'dimPreviewText', anchor: 'rowOne', intensity: [0.95, 0], durationMs: 340, keyframe: true },
        { kind: 'highlight', id: 'markReset', anchor: 'sectionReset', intensity: [0, 0.95], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'sectionReset',
            textKey: 'ponder.captions.visPlayground.sectionReset',
            pointTo: { anchor: 'sectionReset' }, durationMs: 6400, withPrevious: true,
        },
        { kind: 'pause', id: 'readSectionReset' },
    ],
};

/** 第四章：样式在架子上选，「歌词动画」页是它自己的参数；「背景」页是另一层。 */
const visualsSection: PonderSceneScript = {
    id: 'vis-playground-visuals',
    titleKey: 'ponder.scenes.visPlaygroundVisuals',
    anchors,
    steps: [
        { kind: 'highlight', id: 'markShelf', anchor: 'shelf', intensity: [0, 0.7], durationMs: 460, keyframe: true },
        {
            kind: 'caption', id: 'animation',
            textKey: 'ponder.captions.visPlayground.animation',
            pointTo: { anchor: 'shelf' }, durationMs: 6800, withPrevious: true,
        },
        { kind: 'pause', id: 'readAnimation' },

        { kind: 'highlight', id: 'dimShelf', anchor: 'shelf', intensity: [0.7, 0], durationMs: 340, keyframe: true },
        { kind: 'highlight', id: 'markTuning', anchor: 'rows', intensity: [0, 0.5], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'perMode',
            textKey: 'ponder.captions.visPlayground.perMode',
            pointTo: { anchor: 'rows' }, durationMs: 7000, withPrevious: true,
        },
        { kind: 'pause', id: 'readPerMode' },

        { kind: 'highlight', id: 'dimTuning', anchor: 'rows', intensity: [0.5, 0], durationMs: 340, keyframe: true },
        { kind: 'surfaceState', id: 'toBackground', anchor: 'panel', state: 'section-background', durationMs: 480, withPrevious: true },
        {
            kind: 'caption', id: 'background',
            textKey: 'ponder.captions.visPlayground.background',
            pointTo: { anchor: 'backgroundPictures' }, durationMs: 7000, withPrevious: true,
        },
        { kind: 'pause', id: 'readBackground' },
    ],
};

/** 第五章：字幕那一页。内容、底色与模糊，以及字体跟不跟歌词走。 */
const subtitleSection: PonderSceneScript = {
    id: 'vis-playground-subtitle',
    titleKey: 'ponder.scenes.visPlaygroundSubtitle',
    anchors,
    steps: [
        { kind: 'surfaceState', id: 'toSubtitle', anchor: 'panel', state: 'section-subtitle', durationMs: 480, keyframe: true },
        { kind: 'highlight', id: 'markContent', anchor: 'rowTwo', intensity: [0, 0.9], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'content',
            textKey: 'ponder.captions.visPlayground.subtitleContent',
            pointTo: { anchor: 'rowTwo' }, durationMs: 7200, withPrevious: true,
        },
        { kind: 'pause', id: 'readContent' },

        // 字幕透明度、字幕背景、非翻译歌词的模糊：第三到第五行。
        { kind: 'highlight', id: 'dimContent', anchor: 'rowTwo', intensity: [0.9, 0], durationMs: 340, keyframe: true },
        { kind: 'highlight', id: 'markOpacity', anchor: 'rowThree', intensity: [0, 0.9], durationMs: 440, withPrevious: true },
        { kind: 'highlight', id: 'markOverlay', anchor: 'rowFour', intensity: [0, 0.9], durationMs: 440, withPrevious: true },
        { kind: 'highlight', id: 'markBlur', anchor: 'rowFive', intensity: [0, 0.9], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'legibility',
            textKey: 'ponder.captions.visPlayground.subtitleLegibility',
            pointTo: { anchor: 'rowFour' }, durationMs: 6800, withPrevious: true,
        },
        { kind: 'pause', id: 'readLegibility' },

        { kind: 'highlight', id: 'dimOpacity', anchor: 'rowThree', intensity: [0.9, 0], durationMs: 340, keyframe: true },
        { kind: 'highlight', id: 'dimOverlay', anchor: 'rowFour', intensity: [0.9, 0], durationMs: 340, withPrevious: true },
        { kind: 'highlight', id: 'dimBlur', anchor: 'rowFive', intensity: [0.9, 0], durationMs: 340, withPrevious: true },
        { kind: 'highlight', id: 'markFont', anchor: 'subtitleFollowsFont', intensity: [0, 0.95], durationMs: 440, withPrevious: true },
        { kind: 'highlight', id: 'markScale', anchor: 'subtitleScale', intensity: [0, 0.95], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'subtitleFont',
            textKey: 'ponder.captions.visPlayground.subtitleFont',
            pointTo: { anchor: 'subtitleFollowsFont' }, durationMs: 7000, withPrevious: true,
        },
        { kind: 'pause', id: 'readSubtitleFont' },
    ],
};

export default {
    id: 'vis-playground',
    titleKey: 'ponder.targets.visPlayground',
    category: 'appearance',
    summaryKey: 'ponder.summaries.vis_playground',
    hoverSelector: '[data-ponder="vis-playground"]',
    relatedTargetIds: ['lyrics-animation-settings', 'theme-park'],
    scenes: [layout, hotspots, commonSection, visualsSection, subtitleSection],
} satisfies PonderTargetDefinition;
