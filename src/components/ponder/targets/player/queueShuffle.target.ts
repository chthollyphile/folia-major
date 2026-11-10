import { PINNED_COMMANDS_GEOMETRY as P } from '../../surfaces/settings/commandSettings.geometry';
import { SIDE_PANEL_QUEUE_PAGE as Q } from '../../surfaces/panel/sidePanel.geometry';
import { BAR_ANCHORS } from './playerBar.target';
import { PLAYER_PAGE_ANCHORS } from './playerPage.target';
import { SIDE_PANEL_ANCHORS, sidePanelTabCenterX } from '../panel/sidePanelShared';
import { settingsPanel, settingsRegion } from '../settings/settingsSectionShared';
import type { PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/player/queueShuffle.target.ts
// 「随机播放在哪」。
//
// 别的播放器里随机是一个常驻模式，很多人会去循环按钮上找它 —— 连点几下循环按钮的人，
// 多半就是在找随机（见 services/ponder/loopShuffleHint，那条提示送人进来的就是这里）。
// Folia 只有「打乱队列」这一个一次性动作，所以先讲清楚它不是模式，再把四个入口各讲一章：
// 命令、控制条按钮、队列面板上的按钮、命令窗口底部的固定命令。
//
// 每一章借用那一处本来的合成界面，锚点也沿用对应目标的那一组，不另画一份。

const QUEUE_TAB_X = sidePanelTabCenterX('queue');

/** 第一章：没有随机模式，只有打乱队列这一下。 */
const noShuffleMode: PonderSceneScript = {
    id: 'queue-shuffle-no-mode',
    titleKey: 'ponder.scenes.queueShuffleNoMode',
    anchors: {
        ...BAR_ANCHORS,
        queue: {
            kind: 'synthetic',
            rect: { left: 0.5, top: 0.11, width: 0.34, height: 0.34, anchorX: 'center' },
            role: 'surface',
            labelKey: 'ponder.anchors.playerBar.queue',
            surfaceKind: 'queue',
            startsHidden: true,
        },
    },
    steps: [
        { kind: 'highlight', id: 'markSlots', anchor: 'slots', intensity: [0, 0.7], durationMs: 440, keyframe: true },
        {
            kind: 'caption', id: 'noMode',
            textKey: 'ponder.captions.queueShuffle.noMode',
            pointTo: { anchor: 'primarySlot' }, durationMs: 5200, withPrevious: true,
        },
        { kind: 'pause', id: 'readNoMode', dwellMs: 4400 },

        { kind: 'highlight', id: 'dimSlots', anchor: 'slots', intensity: [0.7, 0], durationMs: 360, keyframe: true },
        { kind: 'surfaceState', id: 'putShuffle', anchor: 'bar', state: 'slots-shuffle', durationMs: 420, withPrevious: true },
        // 队列面板默认藏着，得先 reveal 出来，高亮才有东西可亮。
        { kind: 'reveal', id: 'showQueue', anchor: 'queue', transition: 'zoom', durationMs: 460 },
        { kind: 'highlight', id: 'markQueue', anchor: 'queue', intensity: [0, 0.5], durationMs: 360, withPrevious: true },
        { kind: 'cursor', id: 'press', to: { anchor: 'primarySlot' }, press: 'tap', durationMs: 620 },
        { kind: 'highlight', id: 'queueShuffles', anchor: 'queue', intensity: [0.5, 1], durationMs: 700 },
        {
            kind: 'caption', id: 'once',
            textKey: 'ponder.captions.queueShuffle.once',
            pointTo: { anchor: 'queue' }, durationMs: 5200, withPrevious: true,
        },
        { kind: 'pause', id: 'readOnce' },
    ],
};

/** 第二章：命令。执行模式里一个 r，或者在命令窗口里搜。 */
const byCommand: PonderSceneScript = {
    id: 'queue-shuffle-command',
    titleKey: 'ponder.scenes.queueShuffleCommand',
    anchors: PLAYER_PAGE_ANCHORS,
    steps: [
        // 冒号是命令窗口关着时按的那一下，窗口开着时只会打进输入框。见 playerPage 第四章。
        { kind: 'keypress', id: 'colonR', keys: [':', 'r'], at: { anchor: 'bar', y: 0, offset: { y: -18 } }, durationMs: 1400, keyframe: true },
        { kind: 'surfaceState', id: 'executeMode', anchor: 'page', state: 'execute-mode', durationMs: 460, withPrevious: true },
        {
            kind: 'caption', id: 'command',
            textKey: 'ponder.captions.queueShuffle.command',
            pointTo: { anchor: 'palette' }, durationMs: 6000, withPrevious: true,
        },
        { kind: 'pause', id: 'readCommand' },
    ],
};

/** 第三章：放进控制条右边的按钮位。 */
const bySlot: PonderSceneScript = {
    id: 'queue-shuffle-slot',
    titleKey: 'ponder.scenes.queueShuffleSlot',
    action: {
        kind: 'openSettings',
        anchorId: 'bottomUiSettings',
        labelKey: 'ponder.actions.openBottomUiSettings',
    },
    anchors: BAR_ANCHORS,
    steps: [
        { kind: 'surfaceState', id: 'putShuffle', anchor: 'bar', state: 'slots-shuffle', durationMs: 420, keyframe: true },
        { kind: 'highlight', id: 'markSlot', anchor: 'primarySlot', intensity: [0, 0.95], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'slot',
            textKey: 'ponder.captions.queueShuffle.slot',
            pointTo: { anchor: 'primarySlot' }, durationMs: 6200, withPrevious: true,
        },
        { kind: 'pause', id: 'readSlot' },
    ],
};

/** 第四章：右侧控制面板的播放列表页，顶上那一行最右端。 */
const byQueuePanel: PonderSceneScript = {
    id: 'queue-shuffle-panel',
    titleKey: 'ponder.scenes.queueShufflePanel',
    anchors: {
        ...SIDE_PANEL_ANCHORS,
        queueShuffle: { kind: 'relative', from: 'body', rect: Q.shuffle, role: 'region', labelKey: 'ponder.anchors.sidePanel.queueShuffle' },
    },
    steps: [
        { kind: 'cursor', id: 'pickTab', to: { anchor: 'tabs', x: QUEUE_TAB_X }, press: 'tap', durationMs: 660, keyframe: true },
        { kind: 'surfaceState', id: 'openTab', anchor: 'panel', state: 'queue-tab', durationMs: 500 },
        { kind: 'highlight', id: 'markShuffle', anchor: 'queueShuffle', intensity: [0, 0.95], durationMs: 440 },
        {
            kind: 'caption', id: 'panel',
            textKey: 'ponder.captions.queueShuffle.panel',
            pointTo: { anchor: 'queueShuffle' }, durationMs: 5600, withPrevious: true,
        },
        { kind: 'pause', id: 'readPanel' },
    ],
};

/** 第五章：固定命令。设置里放进一个槽位，它就一直在命令窗口底部那一排。 */
const byPinnedCommand: PonderSceneScript = {
    id: 'queue-shuffle-pinned',
    titleKey: 'ponder.scenes.queueShufflePinned',
    action: {
        kind: 'openSettings',
        anchorId: 'pinnedCommands',
        labelKey: 'ponder.actions.openPinnedCommands',
    },
    anchors: {
        panel: settingsPanel('pinned-commands-settings', 'ponder.anchors.pinnedCommands.panel', { top: 0.24, width: 0.48, height: 0.36 }),
        slotThird: settingsRegion(P.slotThird, 'ponder.anchors.pinnedCommands.slotThird'),
        pinnedRow: settingsRegion(P.pinnedRow, 'ponder.anchors.pinnedCommands.pinnedRow'),
    },
    steps: [
        { kind: 'highlight', id: 'markSlot', anchor: 'slotThird', intensity: [0, 0.95], durationMs: 440, keyframe: true },
        {
            kind: 'caption', id: 'pinSlot',
            textKey: 'ponder.captions.queueShuffle.pinSlot',
            pointTo: { anchor: 'slotThird' }, durationMs: 5600, withPrevious: true,
        },
        { kind: 'pause', id: 'readPinSlot', dwellMs: 4800 },

        { kind: 'highlight', id: 'dimSlot', anchor: 'slotThird', intensity: [0.95, 0], durationMs: 360, keyframe: true },
        { kind: 'surfaceState', id: 'showPalette', anchor: 'panel', state: 'palette-preview', transition: 'fade', durationMs: 520, withPrevious: true },
        { kind: 'highlight', id: 'markRow', anchor: 'pinnedRow', intensity: [0, 0.95], durationMs: 420 },
        {
            kind: 'caption', id: 'pinRow',
            textKey: 'ponder.captions.queueShuffle.pinRow',
            pointTo: { anchor: 'pinnedRow' }, durationMs: 5600, withPrevious: true,
        },
        { kind: 'pause', id: 'readPinRow' },
    ],
};

export default {
    id: 'queue-shuffle',
    titleKey: 'ponder.targets.queueShuffle',
    category: 'playback',
    summaryKey: 'ponder.summaries.queue_shuffle',
    // 没有一颗按钮叫「随机」可以悬停：入口是导航页、命令面板，和连点循环按钮时弹出的那条提示。
    hoverSelector: null,
    relatedTargetIds: ['player-bar', 'panel-queue-tab', 'pinned-commands', 'command-palette'],
    scenes: [noShuffleMode, byCommand, bySlot, byQueuePanel, byPinnedCommand],
} satisfies PonderTargetDefinition;
