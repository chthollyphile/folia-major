import { ONLINE_COLLECTION_ACTIONS_GEOMETRY as G } from '../../surfaces/library/localLibrary.geometry';
import type { PonderAnchorSource, PonderRelativeRect, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/library/onlineCollectionActions.target.ts

const panel = {
    kind: 'synthetic',
    rect: { left: 0.5, top: 0.18, width: 0.22, height: 0.58, anchorX: 'center' },
    role: 'surface',
    surfaceKind: 'online-collection-actions',
    labelKey: 'ponder.anchors.onlineCollectionActions.panel',
} satisfies PonderAnchorSource;

const region = (rect: PonderRelativeRect, labelKey: string): PonderAnchorSource => (
    { kind: 'relative', from: 'panel', rect, role: 'region', labelKey }
);

const anchors = {
    panel,
    playAll: region(G.playAll, 'ponder.anchors.onlineCollectionActions.playAll'),
    addQueue: region(G.addQueue, 'ponder.anchors.onlineCollectionActions.addQueue'),
    addPlaylist: region(G.addPlaylist, 'ponder.anchors.onlineCollectionActions.addPlaylist'),
    providerAction: region(G.providerAction, 'ponder.anchors.onlineCollectionActions.providerAction'),
    destructiveAction: region(G.destructiveAction, 'ponder.anchors.onlineCollectionActions.destructiveAction'),
} satisfies Record<string, PonderAnchorSource>;

export default {
    id: 'online-collection-actions',
    titleKey: 'ponder.targets.onlineCollectionActions',
    category: 'browsing',
    summaryKey: 'ponder.summaries.online_collection_actions',
    hoverSelector: '[data-ponder="online-collection-actions"]',
    relatedTargetIds: ['grid-view-page', 'grid-view-edit-mode'],
    scenes: [
        {
            id: 'online-collection-actions-common', titleKey: 'ponder.scenes.onlineCollectionActionsCommon', anchors,
            steps: [
                { kind: 'highlight', id: 'play', anchor: 'playAll', intensity: [0, 0.85], durationMs: 420, keyframe: true },
                { kind: 'highlight', id: 'queue', anchor: 'addQueue', intensity: [0, 0.85], durationMs: 420, withPrevious: true },
                { kind: 'caption', id: 'common', textKey: 'ponder.captions.onlineCollectionActions.common', pointTo: { anchor: 'playAll' }, durationMs: 5400, withPrevious: true },
                { kind: 'pause', id: 'commonRead' },
            ],
        },
        {
            id: 'online-collection-actions-provider', titleKey: 'ponder.scenes.onlineCollectionActionsProvider', anchors,
            steps: [
                { kind: 'highlight', id: 'playlist', anchor: 'addPlaylist', intensity: [0, 0.85], durationMs: 420, keyframe: true },
                { kind: 'highlight', id: 'provider', anchor: 'providerAction', intensity: [0, 0.85], durationMs: 420, withPrevious: true },
                { kind: 'caption', id: 'providerCaption', textKey: 'ponder.captions.onlineCollectionActions.provider', pointTo: { anchor: 'providerAction' }, durationMs: 6200, withPrevious: true },
                { kind: 'pause', id: 'providerRead' },
                { kind: 'highlight', id: 'destructive', anchor: 'destructiveAction', intensity: [0, 0.9], durationMs: 420, keyframe: true },
                { kind: 'caption', id: 'destructiveCaption', textKey: 'ponder.captions.onlineCollectionActions.destructive', pointTo: { anchor: 'destructiveAction' }, durationMs: 5200, withPrevious: true },
                { kind: 'pause', id: 'destructiveRead' },
            ],
        },
    ],
} satisfies PonderTargetDefinition;
