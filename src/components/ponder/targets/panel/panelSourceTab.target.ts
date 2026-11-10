import { SIDE_PANEL_SOURCE_ANCHORS, sidePanelTabCenterX, sidePanelTabRelatedIds } from './sidePanelShared';
import type { PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/panel/panelSourceTab.target.ts
// 控制面板里跟着来源走的那一格：本地 / Navidrome / 在线歌词。
//
// 三者共用一个目标，因为在真实界面里它们**就是同一格** —— 同一个位置、同一套内容骨架
// （歌词、时间轴偏移、两颗按钮、音频增益、来历），只是当前这首歌来自哪儿决定了显示哪一个。
// 拆成三个目标的话，用户永远只会遇到其中一个，另外两个是死的。
//
// 这一格最不直观的地方是它时有时无：当前这首来自 Stage 或者没有来源信息时，
// 标签排就只有四格，于是「我记得这里有一页」会变成找不到。
//
// 「导入 / 导出歌词」那颗按钮也在这里讲：它和在线匹配挨在一起，拆成单独的目标，
// 悬停在它上面的人得到的会是一个只讲一颗按钮、却看不见左右邻居的教程。

const anchors = SIDE_PANEL_SOURCE_ANCHORS;

const pickSourceTab = (id: string) => ([
    { kind: 'cursor' as const, id, to: { anchor: 'tabs', x: sidePanelTabCenterX('source') }, press: 'tap' as const, durationMs: 660, keyframe: true },
    { kind: 'surfaceState' as const, id: `${id}Open`, anchor: 'panel', state: 'source-tab', durationMs: 500 },
]);

/** 第一章：这一格什么时候在，以及它最上面那块。 */
const whenItExists: PonderSceneScript = {
    id: 'panel-source-tab-where',
    titleKey: 'ponder.scenes.panelSourceTabWhere',
    anchors,
    steps: [
        ...pickSourceTab('pickTab'),
        {
            kind: 'caption', id: 'conditional',
            textKey: 'ponder.captions.sidePanel.sourceTab',
            pointTo: { anchor: 'tabs' }, durationMs: 5800, withPrevious: true,
        },
        { kind: 'pause', id: 'readConditional' },

        { kind: 'highlight', id: 'markInfo', anchor: 'sourceInfo', intensity: [0, 0.8], durationMs: 420, keyframe: true },
        {
            kind: 'caption', id: 'info',
            textKey: 'ponder.captions.sidePanel.sourceInfo',
            pointTo: { anchor: 'sourceInfo' }, durationMs: 5600, withPrevious: true,
        },
        { kind: 'pause', id: 'readInfo' },
    ],
};

/** 第二章：歌词从哪来、时间轴偏移、音频增益，按它们在页面上的次序。 */
const contents: PonderSceneScript = {
    id: 'panel-source-tab-contents',
    titleKey: 'ponder.scenes.panelSourceTabContents',
    anchors,
    steps: [
        { kind: 'surfaceState', id: 'openTab', anchor: 'panel', state: 'source-tab', durationMs: 420, keyframe: true },
        { kind: 'highlight', id: 'markLyrics', anchor: 'sourceLyrics', intensity: [0, 0.85], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'lyrics',
            textKey: 'ponder.captions.sidePanel.sourceLyrics',
            pointTo: { anchor: 'sourceLyrics' }, durationMs: 6000, withPrevious: true,
        },
        { kind: 'pause', id: 'readLyrics' },

        // 几块挨得近，上一块不熄掉就会连成一片，看不出此刻在讲哪一块。
        { kind: 'highlight', id: 'dimLyrics', anchor: 'sourceLyrics', intensity: [0.85, 0], durationMs: 400, keyframe: true },
        { kind: 'highlight', id: 'markOffset', anchor: 'sourceOffset', intensity: [0, 0.9], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'offset',
            textKey: 'ponder.captions.sidePanel.sourceOffset',
            pointTo: { anchor: 'sourceOffset' }, durationMs: 6000, withPrevious: true,
        },
        { kind: 'pause', id: 'readOffset' },

        { kind: 'highlight', id: 'dimOffset', anchor: 'sourceOffset', intensity: [0.9, 0], durationMs: 400, keyframe: true },
        { kind: 'highlight', id: 'markGain', anchor: 'sourceGain', intensity: [0, 0.85], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'gain',
            textKey: 'ponder.captions.sidePanel.sourceGain',
            pointTo: { anchor: 'sourceGain' }, durationMs: 6000, withPrevious: true,
        },
        { kind: 'pause', id: 'readGain' },
    ],
};

/**
 * 第三章：「导入 / 导出歌词」那颗按钮。
 *
 * 导入和导出合在一颗按钮、一扇窗口里，所以这一章要讲清按下去之后窗口里有什么：
 * 导入接受哪些文件（包括 Folia 自己导出的 .fia），导出这一首的两种格式怎么取舍，
 * 以及批量导出不在这里做完，而是交给命令面板里那一页。
 */
const lyricFile: PonderSceneScript = {
    id: 'panel-source-tab-export',
    titleKey: 'ponder.scenes.panelSourceTabExport',
    anchors,
    steps: [
        { kind: 'surfaceState', id: 'openTab', anchor: 'panel', state: 'source-tab', durationMs: 420, keyframe: true },
        { kind: 'highlight', id: 'markFile', anchor: 'sourceLyricsFile', intensity: [0, 0.9], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'fileIcon',
            textKey: 'ponder.captions.sidePanel.sourceLyricsFile',
            pointTo: { anchor: 'sourceLyricsFile' }, durationMs: 5200, withPrevious: true,
        },
        { kind: 'pause', id: 'readFileIcon' },

        { kind: 'cursor', id: 'pressFile', to: { anchor: 'sourceLyricsFile' }, press: 'tap', durationMs: 620, keyframe: true },
        { kind: 'highlight', id: 'dimFile', anchor: 'sourceLyricsFile', intensity: [0.9, 0], durationMs: 360, withPrevious: true },
        { kind: 'surfaceState', id: 'openDialog', anchor: 'panel', state: 'source-tab-file-dialog', transition: 'slide-up', durationMs: 460 },
        { kind: 'highlight', id: 'markDialog', anchor: 'sourceFileDialog', intensity: [0, 0.8], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'formats',
            textKey: 'ponder.captions.sidePanel.sourceExportFormats',
            pointTo: { anchor: 'sourceFileDialog' }, durationMs: 7600, withPrevious: true,
        },
        { kind: 'pause', id: 'readFormats' },

        {
            kind: 'caption', id: 'batch',
            textKey: 'ponder.captions.sidePanel.sourceExportBatch',
            pointTo: { anchor: 'sourceFileDialog' }, durationMs: 6400, keyframe: true,
        },
        { kind: 'pause', id: 'readBatch' },
    ],
};

export default {
    id: 'panel-source-tab',
    titleKey: 'ponder.targets.panelSourceTab',
    category: 'playback',
    summaryKey: 'ponder.summaries.panel_source_tab',
    // 三种来源占的是同一格，选择器也就写成一组：谁在场就命中谁。
    // The lyric file button and its dialog belong here too: the dialog is portalled to <body>, so
    // without its own selector hovering inside it would resolve to no target at all.
    hoverSelector: '[data-ponder-panel-tab-button="local"], [data-ponder-panel-tab-button="navi"], [data-ponder-panel-tab-button="onlineLyrics"], [data-ponder-panel-source-lyrics-file], [data-ponder="lyric-file-dialog"]',
    priority: 1,
    relatedTargetIds: [...sidePanelTabRelatedIds('panel-source-tab'), 'lyric-match', 'lyric-export'],
    scenes: [whenItExists, contents, lyricFile],
} satisfies PonderTargetDefinition;
