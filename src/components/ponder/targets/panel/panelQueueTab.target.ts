import { SIDE_PANEL_FM_ANCHORS, sidePanelTabRelatedIds, sidePanelTabScene } from './sidePanelShared';
import type { PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/panel/panelQueueTab.target.ts
// 控制面板里的「队列」标签页。
//
// 一页一个目标：指针停在哪一格上，讲的就是那一页。四页各是一整套设置，
// 合成一章只会变成罗列名词，而读者手上正好停在其中一页。
//
// 第二章讲这一格的另一副面孔：私人 FM 打开时，同一格标签整格换成电台面板 ——
// 名字从「播放列表」变成「电台」，而队列本身就不在了。
// 「我的队列呢」在这种时候是找不到答案的，因为电台根本没有队列。

/** 第二章：私人 FM 打开时，这一格是电台而不是队列。 */
const radio: PonderSceneScript = {
    id: 'panel-queue-tab-radio',
    titleKey: 'ponder.scenes.sidePanelQueueRadio',
    anchors: SIDE_PANEL_FM_ANCHORS,
    steps: [
        { kind: 'surfaceState', id: 'toRadio', anchor: 'panel', state: 'fm-tab', durationMs: 520, keyframe: true },
        {
            kind: 'caption', id: 'sameCell',
            textKey: 'ponder.captions.sidePanel.queueRadio',
            pointTo: { anchor: 'tabs' }, durationMs: 7000, withPrevious: true,
        },
        { kind: 'pause', id: 'readSameCell' },

        { kind: 'highlight', id: 'markMode', anchor: 'fmMode', intensity: [0, 0.95], durationMs: 440, keyframe: true },
        {
            kind: 'caption', id: 'mode',
            textKey: 'ponder.captions.sidePanel.queueRadioMode',
            pointTo: { anchor: 'fmMode' }, durationMs: 6200, withPrevious: true,
        },
        { kind: 'pause', id: 'readMode' },

        { kind: 'highlight', id: 'dimMode', anchor: 'fmMode', intensity: [0.95, 0], durationMs: 360, keyframe: true },
        { kind: 'highlight', id: 'markDiscard', anchor: 'fmDiscard', intensity: [0, 0.95], durationMs: 440, withPrevious: true },
        { kind: 'highlight', id: 'markLike', anchor: 'fmLike', intensity: [0, 0.95], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'actions',
            textKey: 'ponder.captions.sidePanel.queueRadioActions',
            pointTo: { anchor: 'fmDiscard' }, durationMs: 6800, withPrevious: true,
        },
        { kind: 'pause', id: 'readActions' },
    ],
};

export default {
    id: 'panel-queue-tab',
    titleKey: 'ponder.targets.panelQueueTab',
    category: 'playback',
    summaryKey: 'ponder.summaries.panel_queue_tab',
    hoverSelector: '[data-ponder-panel-tab-button="queue"]',
    priority: 1,
    relatedTargetIds: sidePanelTabRelatedIds('panel-queue-tab'),
    scenes: [
        sidePanelTabScene('panel-queue-tab', 'ponder.scenes.sidePanelQueueTab', 'queue-tab', 'queue', ['ponder.captions.sidePanel.queueTab', 'ponder.captions.sidePanel.queueTabDetail']),
        radio,
    ],
} satisfies PonderTargetDefinition;
