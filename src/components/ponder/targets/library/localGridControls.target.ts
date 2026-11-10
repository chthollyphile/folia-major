import { LOCAL_GRID_CONTROLS_GEOMETRY as G } from '../../surfaces/library/localLibrary.geometry';
import type { PonderAnchorSource, PonderRelativeRect, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/library/localGridControls.target.ts

const panel = {
    kind: 'synthetic',
    rect: { left: 0.5, top: 0.25, width: 0.76, height: 0.22, anchorX: 'center' },
    role: 'surface',
    surfaceKind: 'local-grid-controls',
    labelKey: 'ponder.anchors.localGridControls.panel',
} satisfies PonderAnchorSource;

const region = (rect: PonderRelativeRect, labelKey: string): PonderAnchorSource => (
    { kind: 'relative', from: 'panel', rect, role: 'region', labelKey }
);

const anchors = {
    panel,
    tabs: region(G.tabs, 'ponder.anchors.localGridControls.tabs'),
    folders: region(G.folders, 'ponder.anchors.localGridControls.folders'),
    playlists: region(G.playlists, 'ponder.anchors.localGridControls.playlists'),
    imports: region(G.imports, 'ponder.anchors.localGridControls.imports'),
    refresh: region(G.refresh, 'ponder.anchors.localGridControls.refresh'),
    playlistImport: region(G.playlistImport, 'ponder.anchors.localGridControls.playlistImport'),
} satisfies Record<string, PonderAnchorSource>;

export default {
    id: 'local-grid-controls',
    titleKey: 'ponder.targets.localGridControls',
    category: 'browsing',
    summaryKey: 'ponder.summaries.local_grid_controls',
    hoverSelector: '[data-ponder="local-grid-controls"]',
    relatedTargetIds: ['local-grid-map-page', 'local-folder-actions', 'local-library-watch'],
    scenes: [
        {
            id: 'local-grid-controls-sources', titleKey: 'ponder.scenes.localGridControlsSources', anchors,
            steps: [
                { kind: 'highlight', id: 'tabs', anchor: 'tabs', intensity: [0, 0.8], durationMs: 420, keyframe: true },
                { kind: 'caption', id: 'sources', textKey: 'ponder.captions.localGridControls.sources', pointTo: { anchor: 'tabs' }, durationMs: 5200, withPrevious: true },
                { kind: 'pause', id: 'sourcesRead' },
                { kind: 'highlight', id: 'folders', anchor: 'folders', intensity: [0, 0.85], durationMs: 400, keyframe: true },
                { kind: 'highlight', id: 'playlists', anchor: 'playlists', intensity: [0, 0.85], durationMs: 400, withPrevious: true },
                { kind: 'caption', id: 'foldersAndPlaylists', textKey: 'ponder.captions.localGridControls.foldersAndPlaylists', pointTo: { anchor: 'playlists' }, durationMs: 5200, withPrevious: true },
                { kind: 'pause', id: 'foldersAndPlaylistsRead' },
            ],
        },
        {
            id: 'local-grid-controls-maintenance', titleKey: 'ponder.scenes.localGridControlsMaintenance', anchors,
            steps: [
                { kind: 'highlight', id: 'imports', anchor: 'imports', intensity: [0, 0.85], durationMs: 420, keyframe: true },
                { kind: 'highlight', id: 'playlistImport', anchor: 'playlistImport', intensity: [0, 0.85], durationMs: 420, withPrevious: true },
                { kind: 'caption', id: 'importCaption', textKey: 'ponder.captions.localGridControls.imports', pointTo: { anchor: 'imports' }, durationMs: 5400, withPrevious: true },
                { kind: 'pause', id: 'importsRead' },
                { kind: 'highlight', id: 'refresh', anchor: 'refresh', intensity: [0, 0.9], durationMs: 420, keyframe: true },
                { kind: 'caption', id: 'refreshCaption', textKey: 'ponder.captions.localGridControls.refresh', pointTo: { anchor: 'refresh' }, durationMs: 5000, withPrevious: true },
                { kind: 'pause', id: 'refreshRead' },
            ],
        },
    ],
} satisfies PonderTargetDefinition;
