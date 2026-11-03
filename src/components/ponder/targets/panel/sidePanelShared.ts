import {
    SIDE_PANEL_CONTROLS_PAGE as C,
    SIDE_PANEL_COVER_ACTIONS as A,
    SIDE_PANEL_FM_PAGE as F,
    SIDE_PANEL_GEOMETRY as G,
    SIDE_PANEL_SOURCE_PAGE as S,
    SIDE_PANEL_TAB_CELLS as T,
} from '../../surfaces/panel/sidePanel.geometry';
import type { PonderAnchorSource, PonderRelativeRect, PonderSceneScript, PonderTargetId } from '../../../../types/ponder';

// src/components/ponder/targets/panel/sidePanelShared.ts
// 右侧控制面板那一族目标共用的锚点和场景形状。
//
// 文件名刻意不是 *.target.ts：注册表用 import.meta.glob('./targets/**/*.target.ts') 收目标，
// 共用件混进去会被当成一个缺 default export 的目标而直接抛错。
//
// 为什么是一族而不是一个目标：面板里真正需要解释的东西彼此没有关系 —— 封面下面那一行是
// 几个不相干的动作，几个标签页各是一整套设置。全部塞进一个目标，用户悬停在队列标签上
// 得到的是从封面讲起的六章；拆开之后，指哪儿讲哪儿。

/** 面板本身。几何和 sidePanel.surface.tsx 画的那块是同一组数。 */
export const sidePanelAnchor = {
    kind: 'synthetic',
    // aspect 是这张图的 540 ÷ 360：真实面板宽 360，高度跟着内容走，封面页 512、控制页 535。
    // 不锁比例的话，宽屏上按宽度定尺寸的正方形封面会长到压住按高度定位的那一行动作。
    rect: { left: 0.5, top: 0.10, width: 0.32, height: 0.62, aspect: 1.5, anchorX: 'center' },
    role: 'surface',
    surfaceKind: 'side-panel',
    labelKey: 'ponder.anchors.sidePanel.panel',
} satisfies PonderAnchorSource;

const region = (from: string, rect: PonderRelativeRect, labelKey: string): PonderAnchorSource => (
    { kind: 'relative', from, rect, role: 'region', labelKey }
);

/**
 * 面板结构：封面页上的大封面和它下面的歌名歌手专辑；别的页顶上那一行、当前这一页的内容；
 * 以及最底下那排标签。
 */
export const SIDE_PANEL_ANCHORS = {
    panel: sidePanelAnchor,
    cover: region('panel', G.cover, 'ponder.anchors.sidePanel.cover'),
    credits: region('panel', G.credits, 'ponder.anchors.sidePanel.credits'),
    header: region('panel', G.header, 'ponder.anchors.sidePanel.header'),
    body: region('panel', G.body, 'ponder.anchors.sidePanel.body'),
    tabs: region('panel', G.tabs, 'ponder.anchors.sidePanel.tabs'),
} satisfies Record<string, PonderAnchorSource>;

/** 结构锚点加封面页那一行动作。五件各自一个锚点，才指得到「星形那颗」。 */
export const SIDE_PANEL_COVER_ANCHORS = {
    ...SIDE_PANEL_ANCHORS,
    coverActions: region('panel', G.actions, 'ponder.anchors.sidePanel.coverActions'),
    coverLike: region('coverActions', A.like, 'ponder.anchors.sidePanel.coverLike'),
    coverPlaylist: region('coverActions', A.addToPlaylist, 'ponder.anchors.sidePanel.coverPlaylist'),
    coverSource: region('coverActions', A.playingFrom, 'ponder.anchors.sidePanel.coverSource'),
    coverHome: region('coverActions', A.home, 'ponder.anchors.sidePanel.coverHome'),
    coverSettings: region('coverActions', A.settings, 'ponder.anchors.sidePanel.coverSettings'),
} satisfies Record<string, PonderAnchorSource>;

/** 标签排里的哪一格：封面、来源、控制、播放列表、账户。 */
export type SidePanelTab = keyof typeof T;

/** 那一格的中心在整排的哪里（0..1）。光标点一格标签时落在这里。 */
export const sidePanelTabCenterX = (tab: SidePanelTab): number => T[tab].left + T[tab].width / 2;

/** 来源页里的几块，坐标系是 body。 */
export const SIDE_PANEL_SOURCE_ANCHORS = {
    ...SIDE_PANEL_ANCHORS,
    sourceLyrics: region('body', S.lyrics, 'ponder.anchors.sidePanel.sourceLyrics'),
    sourceOffset: region('body', S.offset, 'ponder.anchors.sidePanel.sourceOffset'),
    sourceLyricsFile: region('body', S.fileButton, 'ponder.anchors.sidePanel.sourceLyricsFile'),
    sourceGain: region('body', S.gain, 'ponder.anchors.sidePanel.sourceGain'),
    sourceInfo: region('body', S.info, 'ponder.anchors.sidePanel.sourceInfo'),
    sourceFileDialog: region('body', S.fileDialog, 'ponder.anchors.sidePanel.sourceFileDialog'),
} satisfies Record<string, PonderAnchorSource>;

/** 控制页里歌词样式那一行、它中间那颗按钮，以及点开之后弹出来的那一格图。 */
export const SIDE_PANEL_CONTROLS_ANCHORS = {
    ...SIDE_PANEL_ANCHORS,
    modeRow: region('body', C.modeRowVisualizer, 'ponder.anchors.sidePanel.modeRow'),
    modeName: region('body', C.modeName, 'ponder.anchors.sidePanel.modeName'),
    modeList: region('body', C.modeList, 'ponder.anchors.sidePanel.modeList'),
    modeListFooter: region('body', C.modeListFooter, 'ponder.anchors.sidePanel.modeListFooter'),
} satisfies Record<string, PonderAnchorSource>;

/** 电台页里那几块。私人 FM 打开时，队列那一格整格换成它。 */
export const SIDE_PANEL_FM_ANCHORS = {
    ...SIDE_PANEL_ANCHORS,
    fmMode: region('body', F.modeChip, 'ponder.anchors.sidePanel.fmMode'),
    fmTransport: region('body', F.transport, 'ponder.anchors.sidePanel.fmTransport'),
    fmDiscard: region('body', F.discard, 'ponder.anchors.sidePanel.fmDiscard'),
    fmLike: region('body', F.like, 'ponder.anchors.sidePanel.fmLike'),
} satisfies Record<string, PonderAnchorSource>;

/**
 * 一个标签页的教程：点到那一格、换过去，然后讲这一页是什么、里面有什么。
 *
 * 每个标签页各自一个目标，所以这里只产出一章 —— 用户是悬停在那一格上问「这页是什么」，
 * 不是来看四页连播的。detailAnchor 是第二句指着的那一块：一般是这一页的内容，
 * 封面页没有内容区，指的是封面下面那几行字。
 */
export const sidePanelTabScene = (
    id: string,
    titleKey: string,
    state: string,
    tab: SidePanelTab,
    captionKeys: readonly [string, string],
    detailAnchor: keyof typeof SIDE_PANEL_ANCHORS = 'body',
): PonderSceneScript => ({
    id,
    titleKey,
    anchors: SIDE_PANEL_ANCHORS,
    steps: [
        { kind: 'cursor', id: 'pickTab', to: { anchor: 'tabs', x: sidePanelTabCenterX(tab) }, press: 'tap', durationMs: 660, keyframe: true },
        { kind: 'surfaceState', id: 'openTab', anchor: 'panel', state, durationMs: 500 },
        {
            kind: 'caption', id: 'what',
            textKey: captionKeys[0],
            pointTo: { anchor: 'tabs' }, durationMs: 5200, withPrevious: true,
        },
        { kind: 'pause', id: 'readWhat' },

        { kind: 'highlight', id: 'markBody', anchor: detailAnchor, intensity: [0, 0.55], durationMs: 420, keyframe: true },
        {
            kind: 'caption', id: 'detail',
            textKey: captionKeys[1],
            pointTo: { anchor: detailAnchor }, durationMs: 6200, withPrevious: true,
        },
        { kind: 'pause', id: 'readDetail' },
    ],
});

/** 每个标签页目标都指回整块面板和相邻的那几页。 */
export const sidePanelTabRelatedIds = (self: PonderTargetId): PonderTargetId[] => (
    ([
        'side-panel',
        'panel-cover-tab',
        'panel-source-tab',
        'panel-controls-tab',
        'panel-queue-tab',
        'panel-account-tab',
    ] as PonderTargetId[]).filter(id => id !== self)
);
