import { QUEUE_COMMAND_GEOMETRY as Q } from '../../surfaces/command/queueCommand.geometry';
import type { PonderAnchorSource, PonderRelativeRect, PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/command/queueCommandSurface.target.ts
// {{mod}} + P 打开的那扇队列窗口。
//
// 它长得像命令窗口，做的却是另一件事：输入行是队列的搜索框。两处值得单独讲 ——
//
// 1. `@artist:` / `@album:` 是全仓唯一一处没有任何按钮能替代的语法。不打出来就没有
//    第二条路可以「只看这个歌手的那几首」。
// 2. `--remove` 作用于**筛出来的全部**，不是列表里选中的某一行。误按能一次清掉几十首，
//    所以它先给一条写着「将影响 N 首」的预览，而且没有筛选条件时直接拒绝执行。

const panel = {
    kind: 'synthetic',
    rect: { left: 0.5, top: 0.14, width: 0.46, height: 0.56, anchorX: 'center' },
    role: 'surface',
    surfaceKind: 'queue-command',
    labelKey: 'ponder.anchors.queueCommand.panel',
} satisfies PonderAnchorSource;

const region = (rect: PonderRelativeRect, labelKey: string): PonderAnchorSource => (
    { kind: 'relative', from: 'panel', rect, role: 'region', labelKey }
);

const anchors = {
    panel,
    input: region(Q.input, 'ponder.anchors.queueCommand.input'),
    suggestions: region(Q.suggestions, 'ponder.anchors.queueCommand.suggestions'),
    rows: region(Q.rows, 'ponder.anchors.queueCommand.rows'),
    preview: region(Q.preview, 'ponder.anchors.queueCommand.preview'),
} satisfies Record<string, PonderAnchorSource>;

/** 第一章：这扇窗口是什么，以及 @ 怎么把范围收窄。 */
const facets: PonderSceneScript = {
    id: 'queue-command-facets',
    titleKey: 'ponder.scenes.queueCommandFacets',
    anchors,
    steps: [
        { kind: 'keypress', id: 'openQueue', keys: ['Mod P'], at: { anchor: 'panel', y: 0, offset: { y: -24 } }, durationMs: 1100, keyframe: true },
        { kind: 'highlight', id: 'markInput', anchor: 'input', intensity: [0, 0.7], durationMs: 460, withPrevious: true },
        {
            kind: 'caption', id: 'whatItIs',
            textKey: 'ponder.captions.queueCommand.whatItIs',
            pointTo: { anchor: 'input' }, durationMs: 6000, withPrevious: true,
        },
        { kind: 'pause', id: 'readWhatItIs' },

        { kind: 'highlight', id: 'dimInput', anchor: 'input', intensity: [0.7, 0], durationMs: 400, keyframe: true },
        { kind: 'keypress', id: 'at', keys: ['@'], at: { anchor: 'input', y: 1, offset: { y: 18 } }, durationMs: 900, withPrevious: true },
        { kind: 'surfaceState', id: 'showSuggestions', anchor: 'panel', state: 'facet-suggestions', transition: 'slide-up', durationMs: 460 },
        {
            kind: 'caption', id: 'atSign',
            textKey: 'ponder.captions.queueCommand.atSign',
            pointTo: { anchor: 'suggestions' }, durationMs: 6600, withPrevious: true,
        },
        { kind: 'pause', id: 'readAtSign' },

        { kind: 'surfaceState', id: 'narrow', anchor: 'panel', state: 'facet-narrowed', durationMs: 480, keyframe: true },
        {
            kind: 'caption', id: 'narrowed',
            textKey: 'ponder.captions.queueCommand.narrowed',
            pointTo: { anchor: 'input' }, durationMs: 6200, withPrevious: true,
        },
        { kind: 'pause', id: 'readNarrowed' },
    ],
};

/**
 * 第二章：`--` 的批量操作。
 *
 * 这一章的全部重点是「它动的是谁」—— 不是列表里高亮的那一行，是筛出来的全部。
 */
const batchActions: PonderSceneScript = {
    id: 'queue-command-batch',
    titleKey: 'ponder.scenes.queueCommandBatch',
    anchors,
    steps: [
        { kind: 'surfaceState', id: 'narrow', anchor: 'panel', state: 'facet-narrowed', durationMs: 420, keyframe: true },
        { kind: 'keypress', id: 'dashes', keys: ['--'], at: { anchor: 'input', y: 1, offset: { y: 18 } }, durationMs: 1000, withPrevious: true },
        {
            kind: 'caption', id: 'flags',
            textKey: 'ponder.captions.queueCommand.flags',
            pointTo: { anchor: 'input' }, durationMs: 6200, withPrevious: true,
        },
        { kind: 'pause', id: 'readFlags' },

        { kind: 'surfaceState', id: 'preview', anchor: 'panel', state: 'batch-preview', transition: 'slide-up', durationMs: 500, keyframe: true },
        {
            kind: 'caption', id: 'scope',
            textKey: 'ponder.captions.queueCommand.scope',
            pointTo: { anchor: 'preview' }, durationMs: 6800, withPrevious: true,
        },
        { kind: 'pause', id: 'readScope' },

        {
            kind: 'caption', id: 'guards',
            textKey: 'ponder.captions.queueCommand.guards',
            pointTo: { anchor: 'preview' }, durationMs: 6400, keyframe: true,
        },
        { kind: 'pause', id: 'readGuards' },
    ],
};

export default {
    id: 'queue-command-surface',
    titleKey: 'ponder.targets.queueCommandSurface',
    category: 'playback',
    summaryKey: 'ponder.summaries.queue_command_surface',
    hoverSelector: '[data-testid="command-palette-queue-view"]',
    relatedTargetIds: ['command-palette', 'panel-queue-tab'],
    scenes: [facets, batchActions],
} satisfies PonderTargetDefinition;
