import { PLAYER_PAGE_GEOMETRY as G } from '../../surfaces/player/playerPage.geometry';
import type { PonderAnchorSource, PonderRelativeRect, PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/player/playerPage.target.ts
// 播放页。四章按「先认识、再进入、再会用、最后答疑」排：
//
// 1. 页面上有什么、各在哪
// 2. 怎么把命令窗口叫出来（三条路）
// 3. 命令窗口里怎么执行一条命令（参数 pill 与 `:` 执行模式）
// 4. 常见问题：随机播放到底怎么做
//
// 前三章是递进的，第四章是回答一个真实会被问到的问题 —— Folia 没有随机开关，
// 不讲清楚的话，找不到那个按钮的人只会以为这个功能不存在。
//
// 几何来自 playerPage.geometry，和 PonderPlayerPageSurface 画的是同一组数。

const page = {
    kind: 'synthetic',
    rect: { left: 0.5, top: 0.10, width: 0.64, height: 0.62, anchorX: 'center' },
    role: 'surface',
    surfaceKind: 'player-page',
    labelKey: 'ponder.anchors.pages.player',
} satisfies PonderAnchorSource;

/** 页面里的一块区域：只提供几何，框不画出来 —— 合成界面已经把真实控件画在同一位置了。 */
const region = (rect: PonderRelativeRect, labelKey: string): PonderAnchorSource => (
    { kind: 'relative', from: 'page', rect, role: 'region', labelKey }
);

export const PLAYER_PAGE_ANCHORS = {
    page,
    lyrics: region(G.lyrics, 'ponder.anchors.playerPage.lyrics'),
    bar: region(G.bar, 'ponder.anchors.playerPage.bar'),
    toggle: region(G.toggle, 'ponder.anchors.playerPage.toggle'),
    track: region(G.track, 'ponder.anchors.playerPage.track'),
    panel: region(G.panel, 'ponder.anchors.playerPage.panel'),
    palette: region(G.palette, 'ponder.anchors.playerPage.palette'),
} satisfies Record<string, PonderAnchorSource>;

/** 第一章：页面上有什么，各在哪。 */
const layout: PonderSceneScript = {
    id: 'player-page-layout',
    titleKey: 'ponder.scenes.playerPageLayout',
    anchors: PLAYER_PAGE_ANCHORS,
    steps: [
        { kind: 'highlight', id: 'showPage', anchor: 'page', intensity: [0, 0.35], durationMs: 520, keyframe: true },
        {
            kind: 'caption', id: 'intro',
            textKey: 'ponder.captions.pages.playerLayout',
            pointTo: { anchor: 'page' }, durationMs: 4800, withPrevious: true,
        },
        { kind: 'pause', id: 'readIntro' },

        { kind: 'highlight', id: 'dimPage', anchor: 'page', intensity: [0.35, 0], durationMs: 400, keyframe: true },
        { kind: 'highlight', id: 'markLyrics', anchor: 'lyrics', intensity: [0, 0.6], durationMs: 400, withPrevious: true },
        {
            kind: 'caption', id: 'lyrics',
            textKey: 'ponder.captions.pages.playerLyrics',
            pointTo: { anchor: 'lyrics' }, durationMs: 4600, withPrevious: true,
        },
        { kind: 'pause', id: 'readLyrics' },

        { kind: 'highlight', id: 'markBar', anchor: 'bar', intensity: [0, 0.8], durationMs: 400, keyframe: true },
        {
            kind: 'caption', id: 'bar',
            textKey: 'ponder.captions.pages.playerBarWhere',
            pointTo: { anchor: 'bar' }, durationMs: 4800, withPrevious: true,
        },
        { kind: 'pause', id: 'readBar' },

        { kind: 'highlight', id: 'markToggle', anchor: 'toggle', intensity: [0, 0.9], durationMs: 400, keyframe: true },
        {
            kind: 'caption', id: 'toggle',
            textKey: 'ponder.captions.pages.playerToggleWhere',
            pointTo: { anchor: 'toggle' }, durationMs: 4800, withPrevious: true,
        },
        { kind: 'pause', id: 'readToggle' },

        { kind: 'cursor', id: 'openPanel', to: { anchor: 'toggle' }, press: 'tap', durationMs: 620, keyframe: true },
        { kind: 'surfaceState', id: 'panelOpens', anchor: 'page', state: 'panel-open', transition: 'slide-up', durationMs: 560 },
        {
            kind: 'caption', id: 'panel',
            textKey: 'ponder.captions.pages.playerPanelWhere',
            pointTo: { anchor: 'panel' }, durationMs: 5200, withPrevious: true,
        },
        { kind: 'pause', id: 'readPanel' },
    ],
};

/** 第二章：三条路都通向同一个命令窗口。 */
const openPalette: PonderSceneScript = {
    id: 'player-page-open-palette',
    titleKey: 'ponder.scenes.playerPageOpenPalette',
    anchors: PLAYER_PAGE_ANCHORS,
    steps: [
        { kind: 'highlight', id: 'markTrack', anchor: 'track', intensity: [0, 0.55], durationMs: 420, keyframe: true },
        {
            kind: 'caption', id: 'slideIntro',
            textKey: 'ponder.captions.pages.playerPaletteSlide',
            pointTo: { anchor: 'track' }, durationMs: 4800, withPrevious: true,
        },
        { kind: 'pause', id: 'readSlide' },

        {
            kind: 'drag', id: 'slide',
            from: { anchor: 'toggle' },
            to: { anchor: 'track', x: 0.12 },
            durationMs: 820, keyframe: true,
        },
        { kind: 'surfaceState', id: 'paletteOpens', anchor: 'page', state: 'palette-open', transition: 'slide-up', durationMs: 520 },
        {
            kind: 'caption', id: 'opened',
            textKey: 'ponder.captions.pages.playerPaletteOpened',
            pointTo: { anchor: 'palette' }, durationMs: 4600, withPrevious: true,
        },
        { kind: 'pause', id: 'readOpened' },

        { kind: 'keypress', id: 'keys', keys: ['Mod K'], at: { anchor: 'palette', y: 0, offset: { y: -18 } }, durationMs: 1000, keyframe: true },
        {
            kind: 'caption', id: 'otherWays',
            textKey: 'ponder.captions.pages.playerPaletteOtherWays',
            pointTo: { anchor: 'palette' }, durationMs: 5000, withPrevious: true,
        },
        { kind: 'pause', id: 'readOtherWays' },
    ],
};

/**
 * 第三章：窗口开着之后怎么真的执行一条命令，以及执行模式这条另外的入口。
 *
 * 执行模式必须先把窗口关掉再演：窗口开着时按冒号只会把冒号打进输入框。冒号若是在开着的
 * 窗口下面按的，画面讲的就是「在窗口里输入冒号」，正好是错的那种用法。
 */
const runCommands: PonderSceneScript = {
    id: 'player-page-run-commands',
    titleKey: 'ponder.scenes.playerPageRunCommands',
    anchors: PLAYER_PAGE_ANCHORS,
    steps: [
        { kind: 'surfaceState', id: 'paletteOpens', anchor: 'page', state: 'palette-open', transition: 'slide-up', durationMs: 460, keyframe: true },
        {
            kind: 'caption', id: 'typeToFilter',
            textKey: 'ponder.captions.pages.playerCommandFilter',
            pointTo: { anchor: 'palette' }, durationMs: 5000, withPrevious: true,
        },
        { kind: 'pause', id: 'readFilter' },

        { kind: 'keypress', id: 'argKeys', keys: ['空格', '参数', 'Enter'], at: { anchor: 'palette', y: 0, offset: { y: -18 } }, durationMs: 1300, keyframe: true },
        {
            kind: 'caption', id: 'argument',
            textKey: 'ponder.captions.pages.playerCommandArgument',
            pointTo: { anchor: 'palette' }, durationMs: 5400, withPrevious: true,
        },
        { kind: 'pause', id: 'readArgument' },

        { kind: 'keypress', id: 'escClose', keys: ['Esc'], at: { anchor: 'palette', y: 0, offset: { y: -18 } }, durationMs: 900, keyframe: true },
        { kind: 'surfaceState', id: 'paletteCloses', anchor: 'page', state: 'palette-closed', durationMs: 420 },
        {
            kind: 'caption', id: 'closeFirst',
            textKey: 'ponder.captions.pages.playerExecuteCloseFirst',
            pointTo: { anchor: 'bar' }, durationMs: 5600, withPrevious: true,
        },
        { kind: 'pause', id: 'readCloseFirst' },

        // 冒号挂在控制条上方，和第四章同一个位置：这一下按在播放页上，不是按在窗口里。
        { kind: 'keypress', id: 'colon', keys: [':'], at: { anchor: 'bar', y: 0, offset: { y: -18 } }, durationMs: 900, keyframe: true },
        { kind: 'surfaceState', id: 'executeMode', anchor: 'page', state: 'execute-mode', transition: 'zoom', durationMs: 460 },
        {
            kind: 'caption', id: 'execute',
            textKey: 'ponder.captions.pages.playerExecuteMode',
            pointTo: { anchor: 'palette' }, durationMs: 5600, withPrevious: true,
        },
        { kind: 'pause', id: 'readExecute' },
    ],
};

/** 第四章：常见问题 —— 随机播放在哪。 */
const howToShuffle: PonderSceneScript = {
    id: 'player-page-shuffle',
    titleKey: 'ponder.scenes.playerPageShuffle',
    anchors: PLAYER_PAGE_ANCHORS,
    steps: [
        { kind: 'highlight', id: 'markBar', anchor: 'bar', intensity: [0, 0.6], durationMs: 420, keyframe: true },
        {
            kind: 'caption', id: 'noSwitch',
            textKey: 'ponder.captions.pages.playerShuffleNoSwitch',
            pointTo: { anchor: 'bar' }, durationMs: 5000, withPrevious: true,
        },
        { kind: 'pause', id: 'readNoSwitch' },

        // 不是 Mod+K 之后再按冒号 —— 窗口一开焦点就在输入框里，那时的冒号只会被打进查询。
        // 冒号本身就是打开执行模式的那一下，见 executeModeCommand 的 openHotkey。
        { kind: 'keypress', id: 'colonR', keys: [':', 'r'], at: { anchor: 'bar', y: 0, offset: { y: -18 } }, durationMs: 1400, keyframe: true },
        { kind: 'surfaceState', id: 'executeMode', anchor: 'page', state: 'execute-mode', durationMs: 460, withPrevious: true },
        {
            kind: 'caption', id: 'howTo',
            textKey: 'ponder.captions.pages.playerShuffleHow',
            pointTo: { anchor: 'palette' }, durationMs: 5600, withPrevious: true,
        },
        { kind: 'pause', id: 'readHowTo' },

        {
            kind: 'caption', id: 'alsoSlot',
            textKey: 'ponder.captions.pages.playerShuffleSlot',
            pointTo: { anchor: 'bar' }, durationMs: 5200, keyframe: true,
        },
        { kind: 'pause', id: 'readAlsoSlot' },
    ],
};

export default {
    id: 'player-page',
    titleKey: 'ponder.targets.playerPage',
    category: 'playback',
    summaryKey: 'ponder.summaries.player_page',
    hoverSelector: null,
    relatedTargetIds: ['player-bar', 'command-palette', 'panel-slide', 'side-panel'],
    scenes: [layout, openPalette, runCommands, howToShuffle],
} satisfies PonderTargetDefinition;
