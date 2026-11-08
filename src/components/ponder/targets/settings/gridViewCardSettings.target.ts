import { GRID_VIEW_CARD_GEOMETRY as G } from '../../surfaces/settings/appearanceSettings.geometry';
import { isGridLibraryActive } from '../../../../library/app/gridLibraryActive';
import type { PonderAnchorSource, PonderRelativeRect, PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/settings/gridViewCardSettings.target.ts
// 设置 · 主页与歌单里的「网格卡片」。
//
// 这一组管的是集合页那片蜂窝网格上每张卡的样子。两处不直观：
// 「正方形卡片」要先打开「全画幅封面」才存在；两条滑杆调的不是卡片大小本身，
// 而是「离中心越远衰减到多少」—— 名字里的「最小」指的是衰减的下限，不是尺寸下限。

const panel = {
    kind: 'synthetic',
    rect: { left: 0.5, top: 0.15, width: 0.44, height: 0.48, anchorX: 'center' },
    role: 'surface',
    surfaceKind: 'grid-view-card-settings',
    labelKey: 'ponder.anchors.gridViewCard.panel',
} satisfies PonderAnchorSource;

const region = (rect: PonderRelativeRect, labelKey: string): PonderAnchorSource => (
    { kind: 'relative', from: 'panel', rect, role: 'region', labelKey }
);

const anchors = {
    panel,
    fullBleed: region(G.fullBleed, 'ponder.anchors.gridViewCard.fullBleed'),
    square: region(G.square, 'ponder.anchors.gridViewCard.square'),
    minScale: region(G.minScale, 'ponder.anchors.gridViewCard.minScale'),
    minOpacity: region(G.minOpacity, 'ponder.anchors.gridViewCard.minOpacity'),
    reset: region(G.reset, 'ponder.anchors.gridViewCard.reset'),
} satisfies Record<string, PonderAnchorSource>;

/** 第一章：一个开关解锁另一个开关。 */
const coverShape: PonderSceneScript = {
    id: 'grid-view-card-cover',
    titleKey: 'ponder.scenes.gridViewCardCover',
    action: {
        kind: 'openSettings',
        anchorId: 'gridViewCardSettings',
        labelKey: 'ponder.actions.openGridViewCard',
    },
    anchors,
    steps: [
        { kind: 'highlight', id: 'markFullBleed', anchor: 'fullBleed', intensity: [0, 0.85], durationMs: 440, keyframe: true },
        {
            kind: 'caption', id: 'fullBleed',
            textKey: 'ponder.captions.gridStyle.fullBleed',
            pointTo: { anchor: 'fullBleed' }, durationMs: 5800, withPrevious: true,
        },
        { kind: 'pause', id: 'readFullBleed' },

        { kind: 'cursor', id: 'turnOn', to: { anchor: 'fullBleed', x: 0.93 }, press: 'tap', durationMs: 620, keyframe: true },
        { kind: 'highlight', id: 'dimFullBleed', anchor: 'fullBleed', intensity: [0.85, 0], durationMs: 400, withPrevious: true },
        { kind: 'surfaceState', id: 'squareAppears', anchor: 'panel', state: 'full-bleed-on', transition: 'slide-up', durationMs: 480 },
        {
            kind: 'caption', id: 'square',
            textKey: 'ponder.captions.gridStyle.squareCard',
            pointTo: { anchor: 'square' }, durationMs: 6200, withPrevious: true,
        },
        { kind: 'pause', id: 'readSquare' },
    ],
};

/** 第二章：两条滑杆调的是衰减，不是尺寸。 */
const falloff: PonderSceneScript = {
    id: 'grid-view-card-falloff',
    titleKey: 'ponder.scenes.gridViewCardFalloff',
    anchors,
    steps: [
        { kind: 'highlight', id: 'markScale', anchor: 'minScale', intensity: [0, 0.85], durationMs: 440, keyframe: true },
        {
            kind: 'caption', id: 'scale',
            textKey: 'ponder.captions.gridStyle.minScale',
            pointTo: { anchor: 'minScale' }, durationMs: 6000, withPrevious: true,
        },
        { kind: 'pause', id: 'readScale' },

        { kind: 'highlight', id: 'dimScale', anchor: 'minScale', intensity: [0.85, 0], durationMs: 400, keyframe: true },
        { kind: 'highlight', id: 'markOpacity', anchor: 'minOpacity', intensity: [0, 0.85], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'opacity',
            textKey: 'ponder.captions.gridStyle.minOpacity',
            pointTo: { anchor: 'minOpacity' }, durationMs: 5800, withPrevious: true,
        },
        { kind: 'pause', id: 'readOpacity' },

        { kind: 'highlight', id: 'dimOpacity', anchor: 'minOpacity', intensity: [0.85, 0], durationMs: 400, keyframe: true },
        { kind: 'highlight', id: 'markReset', anchor: 'reset', intensity: [0, 0.9], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'reset',
            textKey: 'ponder.captions.gridStyle.falloffReset',
            pointTo: { anchor: 'reset' }, durationMs: 5200, withPrevious: true,
        },
        { kind: 'pause', id: 'readReset' },
    ],
};

export default {
    id: 'grid-view-card-settings',
    titleKey: 'ponder.targets.gridViewCardSettings',
    category: 'appearance',
    summaryKey: 'ponder.summaries.grid_view_card_settings',
    hoverSelector: '[data-settings-anchor="gridViewCardSettings"]',
    // 只有网格界面有这一组（设置页同一个谓词），别的资料库界面下无处可讲。
    isAvailable: isGridLibraryActive,
    relatedTargetIds: ['grid3d-card-style', 'lattice-style-settings', 'grid-view-page'],
    scenes: [coverShape, falloff],
} satisfies PonderTargetDefinition;
