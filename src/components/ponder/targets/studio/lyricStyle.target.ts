import { VIS_PLAYGROUND_GEOMETRY as G } from '../../surfaces/studio/visPlayground.geometry';
import { LYRIC_STYLE_GEOMETRY as L } from '../../surfaces/studio/lyricStyle.geometry';
import { settingsPanel, settingsRegion } from '../settings/settingsSectionShared';
import type { PonderAnchorSource, PonderRelativeRect, PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/studio/lyricStyle.target.ts
// 歌词样式。埋在控制页「歌词样式 / 背景类型」那两行切换按钮上。
//
// 只讲四件事，都是换样式时真会碰到的：
// 1. 每种样式有自己的一整组设置，换样式就换一整页；
// 2. 莫奈右边那几件东西怎么关 —— 被问得最多的一个；
// 3. 背景和歌词样式各选各的，可以随意组合；
// 4. 大多数样式共用底部那条副字幕，它的设置在「字幕」页，对这些样式一起生效。
//
// 每章都带设置直达，去的是歌词样式窗口对应的那一页 —— 画面画的也正是那个窗口。

const previewPart = (rect: PonderRelativeRect, labelKey: string): PonderAnchorSource => (
    { kind: 'relative', from: 'preview', rect, role: 'region', labelKey }
);

const panelPart = (rect: PonderRelativeRect, labelKey: string): PonderAnchorSource => (
    { kind: 'relative', from: 'settingsPanel', rect, role: 'region', labelKey }
);

const anchors = {
    panel: settingsPanel('lyric-style', 'ponder.anchors.lyricStyle.panel', { top: 0.5, width: 0.92, height: 0.9 }),
    preview: settingsRegion(G.preview, 'ponder.anchors.lyricStyle.preview'),
    settingsPanel: settingsRegion(G.panel, 'ponder.anchors.lyricStyle.settingsPanel'),
    tabs: panelPart(G.tabs, 'ponder.anchors.lyricStyle.tabs'),
    rows: panelPart(G.rows, 'ponder.anchors.lyricStyle.rows'),
    // 莫奈那一页上要讲的三个开关：显示歌曲描述、拖拽调整按钮、显示音频图案。
    monetDescriptionRow: panelPart(G.rowThree, 'ponder.anchors.lyricStyle.monetDescription'),
    monetHangerRow: panelPart(G.rowSix, 'ponder.anchors.lyricStyle.monetHanger'),
    monetAudioRow: panelPart(G.rowSeven, 'ponder.anchors.lyricStyle.monetAudio'),
    backgroundPictures: panelPart(G.backgroundPictures, 'ponder.anchors.lyricStyle.backgroundPictures'),
    // 「字幕」页：副字幕内容在第二行，模糊在第五行，最下面一组是继承歌词字体和字幕缩放。
    subtitleContent: panelPart(G.rowTwo, 'ponder.anchors.lyricStyle.rowTwo'),
    subtitleBlur: panelPart(G.rowFive, 'ponder.anchors.lyricStyle.rowFive'),
    subtitleFollowsFont: panelPart(G.rowEight, 'ponder.anchors.lyricStyle.subtitleFont'),
    subtitleScale: panelPart(G.rowNine, 'ponder.anchors.lyricStyle.subtitleFont'),
    subtitle: previewPart(L.subtitle, 'ponder.anchors.lyricStyle.subtitle'),
    monetDescription: previewPart(L.monetDescription, 'ponder.anchors.lyricStyle.monetDescription'),
    monetHanger: previewPart(L.monetHanger, 'ponder.anchors.lyricStyle.monetHanger'),
    monetAudio: previewPart(L.monetAudio, 'ponder.anchors.lyricStyle.monetAudio'),
} satisfies Record<string, PonderAnchorSource>;

const openStyleSettings = {
    kind: 'openVisualizerSettings',
    section: 'visualizer',
    labelKey: 'ponder.actions.openLyricStyleSettings',
} as const;

/** 第一章：换样式换的是一整页设置，不是同一组参数换个名字。 */
const perStyle: PonderSceneScript = {
    id: 'lyric-style-per-style',
    titleKey: 'ponder.scenes.lyricStylePerStyle',
    action: openStyleSettings,
    anchors,
    steps: [
        { kind: 'highlight', id: 'markRows', anchor: 'rows', intensity: [0, 0.5], durationMs: 460, keyframe: true },
        {
            kind: 'caption', id: 'own',
            textKey: 'ponder.captions.lyricStyle.perStyleOwn',
            pointTo: { anchor: 'rows' }, durationMs: 6400, withPrevious: true,
        },
        { kind: 'pause', id: 'readOwn' },

        { kind: 'highlight', id: 'dimRows', anchor: 'rows', intensity: [0.5, 0], durationMs: 380, keyframe: true },
        { kind: 'surfaceState', id: 'previewB', anchor: 'panel', state: 'preview-style-b', durationMs: 520, withPrevious: true },
        { kind: 'surfaceState', id: 'panelB', anchor: 'panel', state: 'panel-style-b', durationMs: 520, withPrevious: true },
        {
            kind: 'caption', id: 'switch',
            textKey: 'ponder.captions.lyricStyle.perStyleSwitch',
            pointTo: { anchor: 'rows' }, durationMs: 7000, withPrevious: true,
        },
        { kind: 'pause', id: 'readSwitch' },

        {
            kind: 'caption', id: 'where',
            textKey: 'ponder.captions.lyricStyle.perStyleWhere',
            pointTo: { anchor: 'tabs' }, durationMs: 6400, keyframe: true,
        },
        { kind: 'pause', id: 'readWhere' },
    ],
};

/** 第二章：莫奈右边那几件怎么关。每件一拍，预览和右栏那一行同时亮。 */
const monet: PonderSceneScript = {
    id: 'lyric-style-monet',
    titleKey: 'ponder.scenes.lyricStyleMonet',
    action: openStyleSettings,
    anchors,
    steps: [
        { kind: 'surfaceState', id: 'toMonet', anchor: 'panel', state: 'preview-monet', durationMs: 520, keyframe: true },
        { kind: 'surfaceState', id: 'monetPanel', anchor: 'panel', state: 'panel-monet', durationMs: 520, withPrevious: true },
        {
            kind: 'caption', id: 'intro',
            textKey: 'ponder.captions.lyricStyle.monetIntro',
            pointTo: { anchor: 'preview' }, durationMs: 6000, withPrevious: true,
        },
        { kind: 'pause', id: 'readIntro' },

        { kind: 'highlight', id: 'markDescription', anchor: 'monetDescription', intensity: [0, 0.8], durationMs: 420, keyframe: true },
        { kind: 'highlight', id: 'markDescriptionRow', anchor: 'monetDescriptionRow', intensity: [0, 0.8], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'description',
            textKey: 'ponder.captions.lyricStyle.monetDescription',
            pointTo: { anchor: 'monetDescription' }, durationMs: 5600, withPrevious: true,
        },
        { kind: 'pause', id: 'readDescription' },

        { kind: 'highlight', id: 'dimDescription', anchor: 'monetDescription', intensity: [0.8, 0], durationMs: 340, keyframe: true },
        { kind: 'highlight', id: 'dimDescriptionRow', anchor: 'monetDescriptionRow', intensity: [0.8, 0], durationMs: 340, withPrevious: true },
        { kind: 'highlight', id: 'markHanger', anchor: 'monetHanger', intensity: [0, 0.9], durationMs: 420, withPrevious: true },
        { kind: 'highlight', id: 'markHangerRow', anchor: 'monetHangerRow', intensity: [0, 0.8], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'hanger',
            textKey: 'ponder.captions.lyricStyle.monetHanger',
            pointTo: { anchor: 'monetHanger' }, durationMs: 6000, withPrevious: true,
        },
        { kind: 'pause', id: 'readHanger' },

        { kind: 'highlight', id: 'dimHanger', anchor: 'monetHanger', intensity: [0.9, 0], durationMs: 340, keyframe: true },
        { kind: 'highlight', id: 'dimHangerRow', anchor: 'monetHangerRow', intensity: [0.8, 0], durationMs: 340, withPrevious: true },
        { kind: 'highlight', id: 'markAudio', anchor: 'monetAudio', intensity: [0, 0.8], durationMs: 420, withPrevious: true },
        { kind: 'highlight', id: 'markAudioRow', anchor: 'monetAudioRow', intensity: [0, 0.8], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'audio',
            textKey: 'ponder.captions.lyricStyle.monetAudio',
            pointTo: { anchor: 'monetAudio' }, durationMs: 5600, withPrevious: true,
        },
        { kind: 'pause', id: 'readAudio' },

        { kind: 'highlight', id: 'dimAudio', anchor: 'monetAudio', intensity: [0.8, 0], durationMs: 340, keyframe: true },
        { kind: 'highlight', id: 'dimAudioRow', anchor: 'monetAudioRow', intensity: [0.8, 0], durationMs: 340, withPrevious: true },
        { kind: 'surfaceState', id: 'bare', anchor: 'panel', state: 'preview-monet-bare', durationMs: 520, withPrevious: true },
        { kind: 'surfaceState', id: 'togglesOff', anchor: 'panel', state: 'panel-monet-off', durationMs: 520, withPrevious: true },
        {
            kind: 'caption', id: 'bareResult',
            textKey: 'ponder.captions.lyricStyle.monetBare',
            pointTo: { anchor: 'preview' }, durationMs: 6000, withPrevious: true,
        },
        { kind: 'pause', id: 'readBare' },
    ],
};

/** 第三章：背景和歌词样式是两个独立的选择。先只换背景，再只换歌词。 */
const combine: PonderSceneScript = {
    id: 'lyric-style-combine',
    titleKey: 'ponder.scenes.lyricStyleCombine',
    action: {
        kind: 'openVisualizerSettings',
        section: 'background',
        labelKey: 'ponder.actions.openBackgroundSettings',
    },
    anchors,
    steps: [
        { kind: 'highlight', id: 'markPreview', anchor: 'preview', intensity: [0, 0.3], durationMs: 460, keyframe: true },
        {
            kind: 'caption', id: 'two',
            textKey: 'ponder.captions.lyricStyle.combineTwo',
            pointTo: { anchor: 'preview' }, durationMs: 6400, withPrevious: true,
        },
        { kind: 'pause', id: 'readTwo' },

        { kind: 'highlight', id: 'dimPreview', anchor: 'preview', intensity: [0.3, 0], durationMs: 360, keyframe: true },
        { kind: 'surfaceState', id: 'backgroundB', anchor: 'panel', state: 'preview-background-b', durationMs: 560, withPrevious: true },
        { kind: 'surfaceState', id: 'backgroundPanel', anchor: 'panel', state: 'panel-background', durationMs: 520, withPrevious: true },
        {
            kind: 'caption', id: 'background',
            textKey: 'ponder.captions.lyricStyle.combineBackground',
            pointTo: { anchor: 'backgroundPictures' }, durationMs: 6000, withPrevious: true,
        },
        { kind: 'pause', id: 'readBackground' },

        { kind: 'surfaceState', id: 'styleB', anchor: 'panel', state: 'preview-background-b-style-b', durationMs: 560, keyframe: true },
        { kind: 'surfaceState', id: 'stylePanel', anchor: 'panel', state: 'panel-style-b', durationMs: 520, withPrevious: true },
        {
            kind: 'caption', id: 'style',
            textKey: 'ponder.captions.lyricStyle.combineStyle',
            pointTo: { anchor: 'preview' }, durationMs: 6400, withPrevious: true,
        },
        { kind: 'pause', id: 'readStyle' },
    ],
};

/** 第四章：底部那条通用副字幕，以及它在「字幕」页上的几项。 */
const subtitle: PonderSceneScript = {
    id: 'lyric-style-subtitle',
    titleKey: 'ponder.scenes.lyricStyleSubtitle',
    action: {
        kind: 'openVisualizerSettings',
        section: 'subtitle',
        labelKey: 'ponder.actions.openSubtitleSettings',
    },
    anchors,
    steps: [
        { kind: 'highlight', id: 'markSubtitle', anchor: 'subtitle', intensity: [0, 0.85], durationMs: 460, keyframe: true },
        {
            kind: 'caption', id: 'shared',
            textKey: 'ponder.captions.lyricStyle.subtitleShared',
            pointTo: { anchor: 'subtitle' }, durationMs: 6800, withPrevious: true,
        },
        { kind: 'pause', id: 'readShared' },

        { kind: 'highlight', id: 'dimSubtitle', anchor: 'subtitle', intensity: [0.85, 0], durationMs: 340, keyframe: true },
        { kind: 'surfaceState', id: 'subtitlePanel', anchor: 'panel', state: 'panel-subtitle', durationMs: 520, withPrevious: true },
        { kind: 'highlight', id: 'markContent', anchor: 'subtitleContent', intensity: [0, 0.9], durationMs: 420 },
        { kind: 'surfaceState', id: 'romanization', anchor: 'panel', state: 'preview-romanization', durationMs: 520, withPrevious: true },
        {
            kind: 'caption', id: 'content',
            textKey: 'ponder.captions.lyricStyle.subtitleContent',
            pointTo: { anchor: 'subtitleContent' }, durationMs: 6400, withPrevious: true,
        },
        { kind: 'pause', id: 'readContent' },

        { kind: 'highlight', id: 'dimContent', anchor: 'subtitleContent', intensity: [0.9, 0], durationMs: 340, keyframe: true },
        { kind: 'highlight', id: 'markBlur', anchor: 'subtitleBlur', intensity: [0, 0.9], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'blur',
            textKey: 'ponder.captions.lyricStyle.subtitleBlur',
            pointTo: { anchor: 'subtitleBlur' }, durationMs: 5600, withPrevious: true,
        },
        { kind: 'pause', id: 'readBlur' },

        { kind: 'highlight', id: 'dimBlur', anchor: 'subtitleBlur', intensity: [0.9, 0], durationMs: 340, keyframe: true },
        { kind: 'highlight', id: 'markFont', anchor: 'subtitleFollowsFont', intensity: [0, 0.9], durationMs: 420, withPrevious: true },
        { kind: 'highlight', id: 'markSize', anchor: 'subtitleScale', intensity: [0, 0.9], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'font',
            textKey: 'ponder.captions.lyricStyle.subtitleFont',
            pointTo: { anchor: 'subtitleFollowsFont' }, durationMs: 6400, withPrevious: true,
        },
        { kind: 'pause', id: 'readFont' },
    ],
};

export default {
    id: 'lyric-style',
    titleKey: 'ponder.targets.lyricStyle',
    category: 'appearance',
    summaryKey: 'ponder.summaries.lyric_style',
    hoverSelector: '[data-ponder="lyric-style"]',
    // A row's picker opens right under the row: the hint would lie over its first pictures.
    isAvailable: () => typeof document === 'undefined' || !document.querySelector('[data-ponder="lyric-style"] [aria-expanded="true"]'),
    relatedTargetIds: ['panel-controls-tab', 'vis-playground'],
    scenes: [perStyle, monet, combine, subtitle],
} satisfies PonderTargetDefinition;
