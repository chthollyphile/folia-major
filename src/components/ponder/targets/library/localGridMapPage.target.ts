import { LOCAL_GRID_MAP_GEOMETRY as G } from '../../surfaces/library/localLibrary.geometry';
import type { PonderAnchorSource, PonderRelativeRect, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/library/localGridMapPage.target.ts

const page = {
    kind: 'synthetic',
    rect: { left: 0.5, top: 0.10, width: 0.78, height: 0.68, anchorX: 'center' },
    role: 'surface',
    surfaceKind: 'local-grid-map',
    labelKey: 'ponder.anchors.localGridMap.page',
} satisfies PonderAnchorSource;

const region = (rect: PonderRelativeRect, labelKey: string): PonderAnchorSource => (
    { kind: 'relative', from: 'page', rect, role: 'region', labelKey }
);

const anchors = {
    page,
    back: region(G.back, 'ponder.anchors.localGridMap.back'),
    title: region(G.title, 'ponder.anchors.localGridMap.title'),
    cards: region(G.cards, 'ponder.anchors.localGridMap.cards'),
    panel: region(G.panel, 'ponder.anchors.localGridMap.panel'),
    tree: region(G.tree, 'ponder.anchors.localGridMap.tree'),
    actions: region(G.actions, 'ponder.anchors.localGridMap.actions'),
} satisfies Record<string, PonderAnchorSource>;

export default {
    id: 'local-grid-map-page',
    titleKey: 'ponder.targets.localGridMapPage',
    category: 'browsing',
    summaryKey: 'ponder.summaries.local_grid_map_page',
    hoverSelector: null,
    relatedTargetIds: ['local-grid-map-directory-tree', 'local-grid-controls', 'local-folder-actions'],
    scenes: [
        {
            id: 'local-grid-map-structure', titleKey: 'ponder.scenes.localGridMapStructure', anchors,
            steps: [
                { kind: 'highlight', id: 'cards', anchor: 'cards', intensity: [0, 0.65], durationMs: 420, keyframe: true },
                { kind: 'caption', id: 'page', textKey: 'ponder.captions.localGridMap.page', pointTo: { anchor: 'cards' }, durationMs: 5200, withPrevious: true },
                { kind: 'pause', id: 'pageRead' },
                { kind: 'drag', id: 'pan', from: { anchor: 'cards', x: 0.68 }, to: { anchor: 'cards', x: 0.32 }, durationMs: 1000, keyframe: true },
                { kind: 'caption', id: 'cardsCaption', textKey: 'ponder.captions.localGridMap.cards', pointTo: { anchor: 'cards' }, durationMs: 5200, withPrevious: true },
                { kind: 'pause', id: 'cardsRead' },
            ],
        },
        {
            id: 'local-grid-map-batch', titleKey: 'ponder.scenes.localGridMapBatch', anchors,
            steps: [
                { kind: 'cursor', id: 'openPanel', to: { anchor: 'title' }, press: 'tap', durationMs: 680, keyframe: true },
                { kind: 'surfaceState', id: 'panelOpen', anchor: 'page', state: 'tree-open', transition: 'slide-up', durationMs: 520 },
                { kind: 'caption', id: 'panelCaption', textKey: 'ponder.captions.localGridMap.openPanel', pointTo: { anchor: 'panel' }, durationMs: 5400, withPrevious: true },
                { kind: 'pause', id: 'panelRead' },
                { kind: 'highlight', id: 'actions', anchor: 'actions', intensity: [0, 0.85], durationMs: 420, keyframe: true },
                { kind: 'caption', id: 'actionsCaption', textKey: 'ponder.captions.localGridMap.batchActions', pointTo: { anchor: 'actions' }, durationMs: 6000, withPrevious: true },
                { kind: 'pause', id: 'actionsRead' },
            ],
        },
        {
            id: 'local-grid-map-filter', titleKey: 'ponder.scenes.localGridMapFilter', anchors,
            steps: [
                { kind: 'keypress', id: 'filter', keys: ['Mod F'], at: { anchor: 'cards', y: 0.1 }, durationMs: 800, keyframe: true },
                { kind: 'caption', id: 'filterCaption', textKey: 'ponder.captions.localGridMap.filter', pointTo: { anchor: 'cards' }, durationMs: 5600, withPrevious: true },
                { kind: 'pause', id: 'filterRead' },
                { kind: 'highlight', id: 'back', anchor: 'back', intensity: [0, 0.85], durationMs: 420, keyframe: true },
                { kind: 'caption', id: 'backCaption', textKey: 'ponder.captions.localGridMap.back', pointTo: { anchor: 'back' }, durationMs: 4400, withPrevious: true },
                { kind: 'pause', id: 'backRead' },
            ],
        },
    ],
} satisfies PonderTargetDefinition;
