import { TRANSITION_SETTINGS_GEOMETRY as G } from '../../surfaces/settings/playbackSettings.geometry';
import { settingsPanel, settingsRegion } from './settingsSectionShared';
import type { PonderAnchorSource, PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/settings/transitionSettings.target.ts
// 设置 · 播放控制里的「Folia 智能过渡」。
//
// 这一组有一处最容易看走眼：选中 automix 不等于它真的在跑。缺条件时它会悄悄退回
// 淡化，而唯一的提示是选中那张卡右上角那一小块字 —— 从「使用中」变成「已退回淡化」。
//
// 另外它的总开关和控制页音量行右端那颗 14px 的 Blend 图标是同一个值，两处改一个东西。

const anchors = {
    panel: settingsPanel('transition-settings', 'ponder.anchors.transition.panel', { top: 0.16, width: 0.42, height: 0.5 }),
    enable: settingsRegion(G.enable, 'ponder.anchors.transition.enable'),
    crossfade: settingsRegion(G.modeCrossfade, 'ponder.anchors.transition.crossfade'),
    automix: settingsRegion(G.modeAutomix, 'ponder.anchors.transition.automix'),
    badge: settingsRegion(G.badge, 'ponder.anchors.transition.badge'),
    detail: settingsRegion(G.detail, 'ponder.anchors.transition.detail'),
    notice: settingsRegion(G.notice, 'ponder.anchors.transition.notice'),
} satisfies Record<string, PonderAnchorSource>;

/** 第一章：总开关在哪，以及它和控制页那颗图标是同一个值。 */
const enable: PonderSceneScript = {
    id: 'transition-settings-enable',
    titleKey: 'ponder.scenes.transitionSettingsEnable',
    action: {
        kind: 'openSettings',
        anchorId: 'transitionSettings',
        labelKey: 'ponder.actions.openTransitionSettings',
    },
    anchors,
    steps: [
        { kind: 'highlight', id: 'markEnable', anchor: 'enable', intensity: [0, 0.85], durationMs: 460, keyframe: true },
        {
            kind: 'caption', id: 'enable',
            textKey: 'ponder.captions.transition.enable',
            pointTo: { anchor: 'enable' }, durationMs: 6200, withPrevious: true,
        },
        { kind: 'pause', id: 'readEnable' },

        { kind: 'highlight', id: 'dimEnable', anchor: 'enable', intensity: [0.85, 0], durationMs: 400, keyframe: true },
        { kind: 'highlight', id: 'markCrossfade', anchor: 'crossfade', intensity: [0, 0.7], durationMs: 440, withPrevious: true },
        { kind: 'highlight', id: 'markAutomix', anchor: 'automix', intensity: [0, 0.7], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'modes',
            textKey: 'ponder.captions.transition.modes',
            pointTo: { anchor: 'automix' }, durationMs: 6400, withPrevious: true,
        },
        { kind: 'pause', id: 'readModes' },
    ],
};

/** 第二章：那枚徽章。选了不等于在跑。 */
const fallback: PonderSceneScript = {
    id: 'transition-settings-fallback',
    titleKey: 'ponder.scenes.transitionSettingsFallback',
    anchors,
    steps: [
        { kind: 'highlight', id: 'markBadge', anchor: 'badge', intensity: [0, 0.95], durationMs: 460, keyframe: true },
        {
            kind: 'caption', id: 'badge',
            textKey: 'ponder.captions.transition.badge',
            pointTo: { anchor: 'badge' }, durationMs: 6800, withPrevious: true,
        },
        { kind: 'pause', id: 'readBadge' },

        { kind: 'highlight', id: 'dimBadge', anchor: 'badge', intensity: [0.95, 0], durationMs: 400, keyframe: true },
        { kind: 'highlight', id: 'markNotice', anchor: 'notice', intensity: [0, 0.85], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'notice',
            textKey: 'ponder.captions.transition.notice',
            pointTo: { anchor: 'notice' }, durationMs: 6600, withPrevious: true,
        },
        { kind: 'pause', id: 'readNotice' },
    ],
};

export default {
    id: 'transition-settings',
    titleKey: 'ponder.targets.transitionSettings',
    category: 'appearance',
    summaryKey: 'ponder.summaries.transition_settings',
    hoverSelector: '[data-settings-anchor="transitionSettings"]',
    relatedTargetIds: ['panel-controls-tab', 'settings-page'],
    scenes: [enable, fallback],
} satisfies PonderTargetDefinition;
