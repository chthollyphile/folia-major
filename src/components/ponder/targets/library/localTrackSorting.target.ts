import { LOCAL_TRACK_LIST_GEOMETRY as G } from '../../surfaces/library/gridView.geometry';
import type { PonderAnchorSource, PonderRelativeRect, PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/library/localTrackSorting.target.ts
// 曲目列表侧板头上那两颗排序控件。
//
// 它们只对本地文件夹出现（GridView 的 supportsLocalTrackSorting），在线歌单里翻遍也没有 ——
// 用过一次之后到别处找不到，会被当成 bug。而且排序存在 localStorage 里跨会话保留，
// 换一个文件夹进去还是上次那个排法。

const panel = {
    kind: 'synthetic',
    rect: { left: 0.5, top: 0.14, width: 0.26, height: 0.60, anchorX: 'center' },
    role: 'surface',
    surfaceKind: 'local-track-list',
    labelKey: 'ponder.anchors.localTrackList.panel',
} satisfies PonderAnchorSource;

const region = (rect: PonderRelativeRect, labelKey: string): PonderAnchorSource => (
    { kind: 'relative', from: 'panel', rect, role: 'region', labelKey }
);

const anchors = {
    panel,
    direction: region(G.direction, 'ponder.anchors.localTrackList.direction'),
    sortMenu: region(G.sortMenu, 'ponder.anchors.localTrackList.sortMenu'),
    menu: region(G.menu, 'ponder.anchors.localTrackList.menu'),
} satisfies Record<string, PonderAnchorSource>;

const sorting: PonderSceneScript = {
    id: 'local-track-sorting-fields',
    titleKey: 'ponder.scenes.localTrackSortingFields',
    anchors,
    steps: [
        { kind: 'highlight', id: 'markMenu', anchor: 'sortMenu', intensity: [0, 0.9], durationMs: 440, keyframe: true },
        {
            kind: 'caption', id: 'whereOnly',
            textKey: 'ponder.captions.localTrackSorting.whereOnly',
            pointTo: { anchor: 'sortMenu' }, durationMs: 6200, withPrevious: true,
        },
        { kind: 'pause', id: 'readWhereOnly' },

        { kind: 'cursor', id: 'openMenu', to: { anchor: 'sortMenu' }, press: 'tap', durationMs: 620, keyframe: true },
        { kind: 'highlight', id: 'dimMenu', anchor: 'sortMenu', intensity: [0.9, 0], durationMs: 400, withPrevious: true },
        { kind: 'surfaceState', id: 'menuOpens', anchor: 'panel', state: 'sort-menu-open', transition: 'slide-up', durationMs: 460 },
        {
            kind: 'caption', id: 'fields',
            textKey: 'ponder.captions.localTrackSorting.fields',
            pointTo: { anchor: 'menu' }, durationMs: 6200, withPrevious: true,
        },
        { kind: 'pause', id: 'readFields' },

        { kind: 'highlight', id: 'markDirection', anchor: 'direction', intensity: [0, 0.9], durationMs: 440, keyframe: true },
        {
            kind: 'caption', id: 'direction',
            textKey: 'ponder.captions.localTrackSorting.direction',
            pointTo: { anchor: 'direction' }, durationMs: 5800, withPrevious: true,
        },
        { kind: 'pause', id: 'readDirection' },
    ],
};

export default {
    id: 'local-track-sorting',
    titleKey: 'ponder.targets.localTrackSorting',
    category: 'browsing',
    summaryKey: 'ponder.summaries.local_track_sorting',
    hoverSelector: '[data-ponder="local-track-sorting"]',
    relatedTargetIds: ['grid-action-button', 'local-folder-actions'],
    scenes: [sorting],
} satisfies PonderTargetDefinition;
