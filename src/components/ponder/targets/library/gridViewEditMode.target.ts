import { GRID_VIEW_CARDS_GEOMETRY as G } from '../../surfaces/library/gridView.geometry';
import type { PonderAnchorSource, PonderRelativeRect, PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/library/gridViewEditMode.target.ts
// 集合页信息面板里的「编辑」。
//
// 三件事都会让人做错：
// 1. 进去之后卡片上的播放和加入队列**消失**，只剩一个移除用的叉。不是换图标，是整排换掉。
// 2. 本地和 Navidrome 歌单在编辑模式里标题变成输入框，改名**退出时才提交** ——
//    中途按 Esc 或者直接关掉，改动就没了。
// 3. 在线的自有歌单走的是另一条路：就地编辑，没有那个提交步骤。
//
// 移除是立即生效、没有确认的，所以这一章要先说清楚那个叉是什么。

const page = {
    kind: 'synthetic',
    rect: { left: 0.5, top: 0.16, width: 0.58, height: 0.52, anchorX: 'center' },
    role: 'surface',
    surfaceKind: 'grid-view-cards',
    labelKey: 'ponder.anchors.gridViewCards.page',
} satisfies PonderAnchorSource;

const cards = {
    kind: 'relative', from: 'page', rect: G.cards, role: 'region',
    labelKey: 'ponder.anchors.gridViewCards.cards',
} satisfies PonderAnchorSource;

const card = {
    kind: 'relative', from: 'cards', rect: G.card, role: 'region',
    labelKey: 'ponder.anchors.gridViewCards.card',
} satisfies PonderAnchorSource;

const onCard = (rect: PonderRelativeRect, labelKey: string): PonderAnchorSource => (
    { kind: 'relative', from: 'card', rect, role: 'region', labelKey }
);

const anchors = {
    page,
    cards,
    card,
    actions: onCard(G.actions, 'ponder.anchors.gridViewCards.actions'),
    removeBadge: onCard(G.removeBadge, 'ponder.anchors.gridViewCards.remove'),
} satisfies Record<string, PonderAnchorSource>;

/** 第一章：进去之后卡片变成什么样。 */
const whatChanges: PonderSceneScript = {
    id: 'grid-view-edit-mode-cards',
    titleKey: 'ponder.scenes.gridViewEditModeCards',
    anchors,
    steps: [
        { kind: 'highlight', id: 'markActions', anchor: 'actions', intensity: [0, 0.85], durationMs: 440, keyframe: true },
        {
            kind: 'caption', id: 'normal',
            textKey: 'ponder.captions.gridViewEdit.normalCard',
            pointTo: { anchor: 'actions' }, durationMs: 5600, withPrevious: true,
        },
        { kind: 'pause', id: 'readNormal' },

        { kind: 'highlight', id: 'dimActions', anchor: 'actions', intensity: [0.85, 0], durationMs: 400, keyframe: true },
        { kind: 'surfaceState', id: 'enterEdit', anchor: 'page', state: 'edit-mode', durationMs: 480, withPrevious: true },
        {
            kind: 'caption', id: 'edit',
            textKey: 'ponder.captions.gridViewEdit.editCard',
            pointTo: { anchor: 'removeBadge' }, durationMs: 6400, withPrevious: true,
        },
        { kind: 'pause', id: 'readEdit' },
    ],
};

/** 第二章：同一颗按钮对不同来源走的是两条路。 */
const renameCommit: PonderSceneScript = {
    id: 'grid-view-edit-mode-rename',
    titleKey: 'ponder.scenes.gridViewEditModeRename',
    anchors,
    steps: [
        { kind: 'surfaceState', id: 'enterEdit', anchor: 'page', state: 'edit-mode', durationMs: 420, keyframe: true },
        {
            kind: 'caption', id: 'rename',
            textKey: 'ponder.captions.gridViewEdit.rename',
            pointTo: { anchor: 'page' }, durationMs: 6600, withPrevious: true,
        },
        { kind: 'pause', id: 'readRename' },

        {
            kind: 'caption', id: 'online',
            textKey: 'ponder.captions.gridViewEdit.onlinePlaylist',
            pointTo: { anchor: 'cards' }, durationMs: 6000, keyframe: true,
        },
        { kind: 'pause', id: 'readOnline' },
    ],
};

export default {
    id: 'grid-view-edit-mode',
    titleKey: 'ponder.targets.gridViewEditMode',
    category: 'browsing',
    summaryKey: 'ponder.summaries.grid_view_edit_mode',
    hoverSelector: '[data-ponder="grid-view-edit-mode"]',
    relatedTargetIds: ['local-folder-actions', 'grid-view-page'],
    scenes: [whatChanges, renameCommit],
} satisfies PonderTargetDefinition;
