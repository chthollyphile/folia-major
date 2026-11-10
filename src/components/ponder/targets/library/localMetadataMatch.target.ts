import { GRID_VIEW_CARDS_GEOMETRY as G } from '../../surfaces/library/gridView.geometry';
import type { PonderAnchorSource, PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/library/localMetadataMatch.target.ts
// 卡片上那颗「手动匹配歌曲信息」的铅笔。
//
// 三重条件叠在一起才看得到它：卡片得是**当前聚焦**的那张、歌曲得是本地的、
// 指针还得停在歌名那一块上 —— 而且浮出来也只有 65% 不透明度。
// 静态画面上它是零像素，不演一遍没人知道有这回事。

const page = {
    kind: 'synthetic',
    rect: { left: 0.5, top: 0.16, width: 0.58, height: 0.52, anchorX: 'center' },
    role: 'surface',
    surfaceKind: 'grid-view-cards',
    labelKey: 'ponder.anchors.gridViewCards.page',
} satisfies PonderAnchorSource;

const anchors = {
    page,
    cards: { kind: 'relative', from: 'page', rect: G.cards, role: 'region', labelKey: 'ponder.anchors.gridViewCards.cards' },
    card: { kind: 'relative', from: 'cards', rect: G.card, role: 'region', labelKey: 'ponder.anchors.gridViewCards.card' },
    title: { kind: 'relative', from: 'card', rect: G.title, role: 'region', labelKey: 'ponder.anchors.gridViewCards.title' },
    pencil: { kind: 'relative', from: 'card', rect: G.pencil, role: 'region', labelKey: 'ponder.anchors.gridViewCards.pencil' },
} satisfies Record<string, PonderAnchorSource>;

const reveal: PonderSceneScript = {
    id: 'local-metadata-match-reveal',
    titleKey: 'ponder.scenes.localMetadataMatchReveal',
    anchors,
    steps: [
        { kind: 'highlight', id: 'markCard', anchor: 'card', intensity: [0, 0.4], durationMs: 460, keyframe: true },
        {
            kind: 'caption', id: 'conditions',
            textKey: 'ponder.captions.localMetadata.conditions',
            pointTo: { anchor: 'card' }, durationMs: 6400, withPrevious: true,
        },
        { kind: 'pause', id: 'readConditions' },

        { kind: 'highlight', id: 'dimCard', anchor: 'card', intensity: [0.4, 0], durationMs: 400, keyframe: true },
        { kind: 'cursor', id: 'hoverTitle', to: { anchor: 'title' }, durationMs: 700, withPrevious: true },
        { kind: 'surfaceState', id: 'showPencil', anchor: 'page', state: 'metadata-pencil', durationMs: 420 },
        {
            kind: 'caption', id: 'pencil',
            textKey: 'ponder.captions.localMetadata.pencil',
            pointTo: { anchor: 'pencil' }, durationMs: 6000, withPrevious: true,
        },
        { kind: 'pause', id: 'readPencil' },
    ],
};

export default {
    id: 'local-metadata-match',
    titleKey: 'ponder.targets.localMetadataMatch',
    category: 'browsing',
    summaryKey: 'ponder.summaries.local_metadata_match',
    hoverSelector: '[data-ponder="local-metadata-match"]',
    relatedTargetIds: ['local-folder-actions', 'grid-view-edit-mode'],
    scenes: [reveal],
} satisfies PonderTargetDefinition;
