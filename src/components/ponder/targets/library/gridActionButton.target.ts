import { GRID_ACTION_BUTTON_GEOMETRY as G } from '../../surfaces/library/gridView.geometry';
import type { PonderAnchorSource, PonderRelativeRect, PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/library/gridActionButton.target.ts
// 集合页和海报墙右下角那颗按钮。
//
// 它和播放页那颗侧边手柄是同一个手势 —— 点击一个动作，向左滑是另一个。现有的
// panel-slide 只教了播放页那一颗，学会的人没有任何理由猜到这里也能滑。
//
// 而且滑到哪是可配置的（设置 · 交互 → 海报墙操作按钮），轨道尽头那枚图标会跟着变，
// 但不滑一次永远看不到那枚图标。

const page = {
    kind: 'synthetic',
    rect: { left: 0.5, top: 0.14, width: 0.58, height: 0.54, anchorX: 'center' },
    role: 'surface',
    surfaceKind: 'grid-action-button',
    labelKey: 'ponder.anchors.gridActionButton.page',
} satisfies PonderAnchorSource;

const region = (rect: PonderRelativeRect, labelKey: string): PonderAnchorSource => (
    { kind: 'relative', from: 'page', rect, role: 'region', labelKey }
);

const anchors = {
    page,
    button: region(G.button, 'ponder.anchors.gridActionButton.button'),
    track: region(G.track, 'ponder.anchors.gridActionButton.track'),
    listPanel: region(G.listPanel, 'ponder.anchors.gridActionButton.list'),
    filterBar: region(G.filterBar, 'ponder.anchors.gridActionButton.slideTarget'),
} satisfies Record<string, PonderAnchorSource>;

/** 第一章：点一下开曲目列表。 */
const tapOpensList: PonderSceneScript = {
    id: 'grid-action-button-list',
    titleKey: 'ponder.scenes.gridActionButtonList',
    anchors,
    steps: [
        { kind: 'highlight', id: 'markButton', anchor: 'button', intensity: [0, 0.9], durationMs: 440, keyframe: true },
        {
            kind: 'caption', id: 'tap',
            textKey: 'ponder.captions.gridActionButton.tap',
            pointTo: { anchor: 'button' }, durationMs: 5200, withPrevious: true,
        },
        { kind: 'pause', id: 'readTap' },

        { kind: 'cursor', id: 'openList', to: { anchor: 'button' }, press: 'tap', durationMs: 620, keyframe: true },
        { kind: 'highlight', id: 'dimButton', anchor: 'button', intensity: [0.9, 0], durationMs: 400, withPrevious: true },
        { kind: 'surfaceState', id: 'listOpens', anchor: 'page', state: 'list-open', transition: 'slide-up', durationMs: 500 },
        {
            kind: 'caption', id: 'list',
            textKey: 'ponder.captions.gridActionButton.list',
            pointTo: { anchor: 'listPanel' }, durationMs: 5600, withPrevious: true,
        },
        { kind: 'pause', id: 'readList' },
    ],
};

/** 第二章：往左滑是第二个动作，而且那个动作是可配置的。 */
const slideOpensTarget: PonderSceneScript = {
    id: 'grid-action-button-slide',
    titleKey: 'ponder.scenes.gridActionButtonSlide',
    action: {
        kind: 'openSettings',
        anchorId: 'gridActionButton',
        labelKey: 'ponder.actions.openGridActionButton',
    },
    anchors,
    steps: [
        { kind: 'highlight', id: 'markTrack', anchor: 'track', intensity: [0, 0.55], durationMs: 440, keyframe: true },
        {
            kind: 'caption', id: 'hiddenTrack',
            textKey: 'ponder.captions.gridActionButton.track',
            pointTo: { anchor: 'track' }, durationMs: 5600, withPrevious: true,
        },
        { kind: 'pause', id: 'readTrack' },

        {
            kind: 'drag', id: 'slide',
            from: { anchor: 'button' },
            to: { anchor: 'track', x: 0.12 },
            durationMs: 820, keyframe: true,
        },
        { kind: 'highlight', id: 'dimTrack', anchor: 'track', intensity: [0.55, 0], durationMs: 400, withPrevious: true },
        { kind: 'surfaceState', id: 'targetOpens', anchor: 'page', state: 'slide-target-open', transition: 'zoom', durationMs: 500 },
        {
            kind: 'caption', id: 'target',
            textKey: 'ponder.captions.gridActionButton.slideTarget',
            pointTo: { anchor: 'filterBar' }, durationMs: 6200, withPrevious: true,
        },
        { kind: 'pause', id: 'readTarget' },
    ],
};

export default {
    id: 'grid-action-button',
    titleKey: 'ponder.targets.gridActionButton',
    category: 'browsing',
    summaryKey: 'ponder.summaries.grid_action_button',
    hoverSelector: '[data-testid="grid-list-search-button"]',
    relatedTargetIds: ['panel-slide', 'grid-view-page', 'local-track-sorting'],
    scenes: [tapOpensList, slideOpensTarget],
} satisfies PonderTargetDefinition;
