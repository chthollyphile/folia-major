import { QUEUE_SETTINGS_GEOMETRY as G } from '../../surfaces/settings/playbackSettings.geometry';
import { settingsPanel, settingsRegion } from './settingsSectionShared';
import type { PonderAnchorSource, PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/settings/queueSettings.target.ts
// 设置 · 播放控制 · 播放行为里的「加入队列的默认位置」。
//
// 只有两个选项，但它改的是全应用所有「加入队列」的语义：卡片上那颗、队列行悬停浮出
// 的那颗、命令窗口里那条，全部跟着它走。一个设置改十处行为，值得单独说一句。

const anchors = {
    panel: settingsPanel('queue-settings', 'ponder.anchors.queueSettings.panel', { top: 0.3, width: 0.42, height: 0.22 }),
    append: settingsRegion(G.optionAppend, 'ponder.anchors.queueSettings.append'),
    next: settingsRegion(G.optionNext, 'ponder.anchors.queueSettings.next'),
} satisfies Record<string, PonderAnchorSource>;

const behavior: PonderSceneScript = {
    id: 'queue-settings-behavior',
    titleKey: 'ponder.scenes.queueSettingsBehavior',
    action: {
        kind: 'openSettings',
        anchorId: 'queueSettings',
        labelKey: 'ponder.actions.openQueueSettings',
    },
    anchors,
    steps: [
        { kind: 'highlight', id: 'markAppend', anchor: 'append', intensity: [0, 0.85], durationMs: 460, keyframe: true },
        {
            kind: 'caption', id: 'append',
            textKey: 'ponder.captions.queueSettings.append',
            pointTo: { anchor: 'append' }, durationMs: 5800, withPrevious: true,
        },
        { kind: 'pause', id: 'readAppend' },

        { kind: 'highlight', id: 'dimAppend', anchor: 'append', intensity: [0.85, 0], durationMs: 400, keyframe: true },
        { kind: 'highlight', id: 'markNext', anchor: 'next', intensity: [0, 0.85], durationMs: 460, withPrevious: true },
        {
            kind: 'caption', id: 'next',
            textKey: 'ponder.captions.queueSettings.next',
            pointTo: { anchor: 'next' }, durationMs: 6400, withPrevious: true,
        },
        { kind: 'pause', id: 'readNext' },
    ],
};

export default {
    id: 'queue-settings',
    titleKey: 'ponder.targets.queueSettings',
    category: 'playback',
    summaryKey: 'ponder.summaries.queue_settings',
    hoverSelector: '[data-settings-row="queueDefaultBehavior"]',
    relatedTargetIds: ['panel-queue-tab', 'queue-command-surface'],
    scenes: [behavior],
} satisfies PonderTargetDefinition;
