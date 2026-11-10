import { LOCAL_GRID_MAP_GEOMETRY as G } from '../../surfaces/library/localLibrary.geometry';
import type { PonderAnchorSource, PonderRelativeRect, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/library/localGridMapDirectoryTree.target.ts

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
    tree: region(G.tree, 'ponder.anchors.localGridMap.tree'),
    row: region(G.row, 'ponder.anchors.localGridMap.row'),
    checkbox: region(G.checkbox, 'ponder.anchors.localGridMap.checkbox'),
    expand: region(G.expand, 'ponder.anchors.localGridMap.expand'),
    rootActions: region(G.rootActions, 'ponder.anchors.localGridMap.rootActions'),
} satisfies Record<string, PonderAnchorSource>;

export default {
    id: 'local-grid-map-directory-tree',
    titleKey: 'ponder.targets.localGridMapDirectoryTree',
    category: 'browsing',
    summaryKey: 'ponder.summaries.local_grid_map_directory_tree',
    hoverSelector: '[data-ponder="local-grid-map-directory-tree"]',
    relatedTargetIds: ['local-grid-map-page', 'local-library-watch'],
    scenes: [
        {
            id: 'local-grid-map-directory-hierarchy', titleKey: 'ponder.scenes.localGridMapDirectoryHierarchy', anchors,
            steps: [
                { kind: 'surfaceState', id: 'treeOpen', anchor: 'page', state: 'tree-open', durationMs: 320 },
                { kind: 'highlight', id: 'tree', anchor: 'tree', intensity: [0, 0.75], durationMs: 420, keyframe: true },
                { kind: 'caption', id: 'hierarchy', textKey: 'ponder.captions.localGridMapDirectory.hierarchy', pointTo: { anchor: 'tree' }, durationMs: 5600, withPrevious: true },
                { kind: 'pause', id: 'hierarchyRead' },
                { kind: 'cursor', id: 'expand', to: { anchor: 'expand' }, press: 'tap', durationMs: 620, keyframe: true },
                { kind: 'caption', id: 'expandCaption', textKey: 'ponder.captions.localGridMapDirectory.expand', pointTo: { anchor: 'expand' }, durationMs: 5200, withPrevious: true },
                { kind: 'pause', id: 'expandRead' },
            ],
        },
        {
            id: 'local-grid-map-directory-selection', titleKey: 'ponder.scenes.localGridMapDirectorySelection', anchors,
            steps: [
                { kind: 'surfaceState', id: 'treeOpen', anchor: 'page', state: 'tree-open', durationMs: 320 },
                { kind: 'cursor', id: 'select', to: { anchor: 'checkbox' }, press: 'tap', durationMs: 620, keyframe: true },
                { kind: 'caption', id: 'selectionCaption', textKey: 'ponder.captions.localGridMapDirectory.selection', pointTo: { anchor: 'checkbox' }, durationMs: 6800, withPrevious: true },
                { kind: 'pause', id: 'selectionRead' },
                { kind: 'highlight', id: 'rootActions', anchor: 'rootActions', intensity: [0, 0.9], durationMs: 420, keyframe: true },
                { kind: 'caption', id: 'rootCaption', textKey: 'ponder.captions.localGridMapDirectory.rootActions', pointTo: { anchor: 'rootActions' }, durationMs: 5800, withPrevious: true },
                { kind: 'pause', id: 'rootRead' },
            ],
        },
    ],
} satisfies PonderTargetDefinition;
