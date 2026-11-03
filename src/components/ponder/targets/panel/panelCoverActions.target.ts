import { SIDE_PANEL_COVER_ANCHORS } from './sidePanelShared';
import type { PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/panel/panelCoverActions.target.ts
// 控制面板封面页上，歌名下面那一行按钮。
//
// 这一行一直在，不用悬停，但五件事彼此没有关系：喜欢、加入歌单、回到这份队列的来处，
// 以及右端回到首页、打开设置。其中两件时有时无（来源不支持歌单；队列不来自某张歌单），
// 一句「这首歌的操作」既漏掉了右端那两条离开面板的路，也讲不出它们为什么有时不在。
//
// 单独成一个目标而不是并进 side-panel：用户是指着封面问「这下面是什么」的，
// 而不是想从头看一遍面板结构。

const anchors = SIDE_PANEL_COVER_ANCHORS;

/** 第一章：这一行在哪，以及左边三件 —— 对这首歌做的事。 */
const songActions: PonderSceneScript = {
    id: 'panel-cover-actions-reveal',
    titleKey: 'ponder.scenes.panelCoverActionsReveal',
    anchors,
    steps: [
        { kind: 'highlight', id: 'markRow', anchor: 'coverActions', intensity: [0, 0.6], durationMs: 420, keyframe: true },
        {
            kind: 'caption', id: 'appear',
            textKey: 'ponder.captions.panelCoverActions.appear',
            pointTo: { anchor: 'coverActions' }, durationMs: 5800, withPrevious: true,
        },
        { kind: 'pause', id: 'readAppear' },

        { kind: 'highlight', id: 'dimRow', anchor: 'coverActions', intensity: [0.6, 0], durationMs: 400, keyframe: true },
        { kind: 'highlight', id: 'markLike', anchor: 'coverLike', intensity: [0, 0.9], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'like',
            textKey: 'ponder.captions.panelCoverActions.like',
            pointTo: { anchor: 'coverLike' }, durationMs: 5200, withPrevious: true,
        },
        { kind: 'pause', id: 'readLike' },

        { kind: 'highlight', id: 'dimLike', anchor: 'coverLike', intensity: [0.9, 0], durationMs: 400, keyframe: true },
        { kind: 'highlight', id: 'markPlaylist', anchor: 'coverPlaylist', intensity: [0, 0.9], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'playlist',
            textKey: 'ponder.captions.panelCoverActions.addToPlaylist',
            pointTo: { anchor: 'coverPlaylist' }, durationMs: 5600, withPrevious: true,
        },
        { kind: 'pause', id: 'readPlaylist' },

        { kind: 'highlight', id: 'dimPlaylist', anchor: 'coverPlaylist', intensity: [0.9, 0], durationMs: 400, keyframe: true },
        { kind: 'highlight', id: 'markSource', anchor: 'coverSource', intensity: [0, 0.9], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'playingFrom',
            textKey: 'ponder.captions.panelCoverActions.playingFrom',
            pointTo: { anchor: 'coverSource' }, durationMs: 6000, withPrevious: true,
        },
        { kind: 'pause', id: 'readPlayingFrom' },
    ],
};

/** 第二章：右端那两颗 —— 离开面板的两条路。 */
const rightEnd: PonderSceneScript = {
    id: 'panel-cover-actions-right',
    titleKey: 'ponder.scenes.panelCoverActionsRight',
    anchors,
    steps: [
        { kind: 'highlight', id: 'markHome', anchor: 'coverHome', intensity: [0, 0.9], durationMs: 420, keyframe: true },
        {
            kind: 'caption', id: 'home',
            textKey: 'ponder.captions.panelCoverActions.home',
            pointTo: { anchor: 'coverHome' }, durationMs: 5200, withPrevious: true,
        },
        { kind: 'pause', id: 'readHome' },

        { kind: 'highlight', id: 'dimHome', anchor: 'coverHome', intensity: [0.9, 0], durationMs: 400, keyframe: true },
        { kind: 'highlight', id: 'markSettings', anchor: 'coverSettings', intensity: [0, 0.9], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'settings',
            textKey: 'ponder.captions.panelCoverActions.settings',
            pointTo: { anchor: 'coverSettings' }, durationMs: 5400, withPrevious: true,
        },
        { kind: 'pause', id: 'readSettings' },
    ],
};

export default {
    id: 'panel-cover-actions',
    titleKey: 'ponder.targets.panelCoverActions',
    category: 'playback',
    summaryKey: 'ponder.summaries.panel_cover_actions',
    hoverSelector: '[data-ponder-panel-artwork]',
    // 封面整块都在面板选择器里，深度相同的情况不会出现；priority 用来保证嵌套关系稳定。
    priority: 1,
    relatedTargetIds: ['side-panel', 'panel-cover-tab'],
    scenes: [songActions, rightEnd],
} satisfies PonderTargetDefinition;
