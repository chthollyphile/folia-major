import { LOCAL_FOLDER_ACTIONS_GEOMETRY as G } from '../../surfaces/library/gridView.geometry';
import type { PonderAnchorSource, PonderRelativeRect, PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/library/localFolderActions.target.ts
// 集合页信息面板底部那一列来源专属动作。
//
// 这一列的内容完全取决于打开的是什么集合：本地文件夹有重扫和整理 tag，本地歌单有导出，
// 本地专辑/艺人有编辑实体 —— 判据见 library/core/collection/collectionSurface.ts。
// 在线与 Navidrome 集合由 onlineCollectionActions target 单独说明，避免混淆来源能力。
//
// 最后那颗红的会删东西，而它和上面几颗只差一个颜色。

const panel = {
    kind: 'synthetic',
    rect: { left: 0.5, top: 0.20, width: 0.20, height: 0.52, anchorX: 'center' },
    role: 'surface',
    surfaceKind: 'local-folder-actions',
    labelKey: 'ponder.anchors.localFolderActions.panel',
} satisfies PonderAnchorSource;

const region = (rect: PonderRelativeRect, labelKey: string): PonderAnchorSource => (
    { kind: 'relative', from: 'panel', rect, role: 'region', labelKey }
);

const anchors = {
    panel,
    playAll: region(G.playAll, 'ponder.anchors.localFolderActions.playAll'),
    reimport: region(G.reimport, 'ponder.anchors.localFolderActions.reimport'),
    organize: region(G.organize, 'ponder.anchors.localFolderActions.organize'),
    remove: region(G.remove, 'ponder.anchors.localFolderActions.remove'),
} satisfies Record<string, PonderAnchorSource>;

/** 第一章：这一列有什么取决于你打开的是什么。 */
const whatIsHere: PonderSceneScript = {
    id: 'local-folder-actions-list',
    titleKey: 'ponder.scenes.localFolderActionsList',
    anchors,
    steps: [
        { kind: 'highlight', id: 'markPanel', anchor: 'panel', intensity: [0, 0.35], durationMs: 480, keyframe: true },
        {
            kind: 'caption', id: 'conditional',
            textKey: 'ponder.captions.localFolderActions.conditional',
            pointTo: { anchor: 'panel' }, durationMs: 6400, withPrevious: true,
        },
        { kind: 'pause', id: 'readConditional' },

        { kind: 'highlight', id: 'dimPanel', anchor: 'panel', intensity: [0.35, 0], durationMs: 400, keyframe: true },
        { kind: 'highlight', id: 'markPlayAll', anchor: 'playAll', intensity: [0, 0.85], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'playAll',
            textKey: 'ponder.captions.localFolderActions.playAll',
            pointTo: { anchor: 'playAll' }, durationMs: 5600, withPrevious: true,
        },
        { kind: 'pause', id: 'readPlayAll' },
    ],
};

/** 第二章：重扫和整理 tag —— 两颗名字都不自解释的。 */
const maintenance: PonderSceneScript = {
    id: 'local-folder-actions-maintenance',
    titleKey: 'ponder.scenes.localFolderActionsMaintenance',
    anchors,
    steps: [
        { kind: 'highlight', id: 'markReimport', anchor: 'reimport', intensity: [0, 0.85], durationMs: 440, keyframe: true },
        {
            kind: 'caption', id: 'reimport',
            textKey: 'ponder.captions.localFolderActions.reimport',
            pointTo: { anchor: 'reimport' }, durationMs: 6200, withPrevious: true,
        },
        { kind: 'pause', id: 'readReimport' },

        { kind: 'highlight', id: 'dimReimport', anchor: 'reimport', intensity: [0.85, 0], durationMs: 400, keyframe: true },
        { kind: 'highlight', id: 'markOrganize', anchor: 'organize', intensity: [0, 0.85], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'organize',
            textKey: 'ponder.captions.localFolderActions.organize',
            pointTo: { anchor: 'organize' }, durationMs: 6000, withPrevious: true,
        },
        { kind: 'pause', id: 'readOrganize' },
    ],
};

/** 第三章：红的那颗。会删东西，所以单独一章。 */
const deletion: PonderSceneScript = {
    id: 'local-folder-actions-delete',
    titleKey: 'ponder.scenes.localFolderActionsDelete',
    anchors,
    steps: [
        { kind: 'highlight', id: 'markRemove', anchor: 'remove', intensity: [0, 0.9], durationMs: 440, keyframe: true },
        {
            kind: 'caption', id: 'remove',
            textKey: 'ponder.captions.localFolderActions.remove',
            pointTo: { anchor: 'remove' }, durationMs: 6400, withPrevious: true,
        },
        { kind: 'pause', id: 'readRemove' },

        { kind: 'cursor', id: 'press', to: { anchor: 'remove' }, press: 'tap', durationMs: 620, keyframe: true },
        { kind: 'highlight', id: 'dimRemove', anchor: 'remove', intensity: [0.9, 0], durationMs: 400, withPrevious: true },
        { kind: 'surfaceState', id: 'showConfirm', anchor: 'panel', state: 'delete-confirm', transition: 'zoom', durationMs: 480 },
        {
            kind: 'caption', id: 'confirm',
            textKey: 'ponder.captions.localFolderActions.confirm',
            pointTo: { anchor: 'panel' }, durationMs: 6600, withPrevious: true,
        },
        { kind: 'pause', id: 'readConfirm' },
    ],
};

export default {
    id: 'local-folder-actions',
    titleKey: 'ponder.targets.localFolderActions',
    category: 'browsing',
    summaryKey: 'ponder.summaries.local_folder_actions',
    hoverSelector: '[data-ponder="local-folder-actions"]',
    relatedTargetIds: ['grid-view-edit-mode', 'local-metadata-match', 'local-track-sorting'],
    scenes: [whatIsHere, maintenance, deletion],
} satisfies PonderTargetDefinition;
