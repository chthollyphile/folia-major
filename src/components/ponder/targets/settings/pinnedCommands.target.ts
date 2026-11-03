import { PINNED_COMMANDS_GEOMETRY as G } from '../../surfaces/settings/commandSettings.geometry';
import { settingsPanel, settingsRegion } from './settingsSectionShared';
import type { PonderAnchorSource, PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/settings/pinnedCommands.target.ts
// 设置 · 通用里的「固定命令」。
//
// 它和「最近用过的排前面」是两套完全独立的机制，存在不同的 localStorage 键里：
// 列表排序会随使用次数自己变，这三颗不会 —— 你放什么它们就一直是什么。
// 界面上这两件事从来没有摆在一起说过，于是「我明明固定了，怎么位置还在动」是常见误解。
//
// 这一组配出来的东西也不长在设置里，而长在命令窗口下面那一排，所以第二章整屏换成窗口本身。

const anchors = {
    panel: settingsPanel('pinned-commands-settings', 'ponder.anchors.pinnedCommands.panel', { top: 0.24, width: 0.48, height: 0.36 }),
    slotFirst: settingsRegion(G.slotFirst, 'ponder.anchors.pinnedCommands.slotFirst'),
    slotSecond: settingsRegion(G.slotSecond, 'ponder.anchors.pinnedCommands.slotSecond'),
    slotThird: settingsRegion(G.slotThird, 'ponder.anchors.pinnedCommands.slotThird'),
    palette: settingsRegion(G.palette, 'ponder.anchors.pinnedCommands.palette'),
    paletteList: { kind: 'relative', from: 'palette', rect: G.paletteList, role: 'region', labelKey: 'ponder.anchors.pinnedCommands.paletteList' },
    pinnedRow: settingsRegion(G.pinnedRow, 'ponder.anchors.pinnedCommands.pinnedRow'),
} satisfies Record<string, PonderAnchorSource>;

/** 第一章：三个槽位是什么，以及一个命令只能占一个槽。 */
const theSlots: PonderSceneScript = {
    id: 'pinned-commands-slots',
    titleKey: 'ponder.scenes.pinnedCommandsSlots',
    action: {
        kind: 'openSettings',
        anchorId: 'pinnedCommands',
        labelKey: 'ponder.actions.openPinnedCommands',
    },
    anchors,
    steps: [
        { kind: 'highlight', id: 'markFirst', anchor: 'slotFirst', intensity: [0, 0.8], durationMs: 440, keyframe: true },
        { kind: 'highlight', id: 'markSecond', anchor: 'slotSecond', intensity: [0, 0.8], durationMs: 440, withPrevious: true },
        { kind: 'highlight', id: 'markThird', anchor: 'slotThird', intensity: [0, 0.8], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'slots',
            textKey: 'ponder.captions.pinnedCommands.slots',
            pointTo: { anchor: 'slotSecond' }, durationMs: 6400, withPrevious: true,
        },
        { kind: 'pause', id: 'readSlots' },

        { kind: 'highlight', id: 'dimFirst', anchor: 'slotFirst', intensity: [0.8, 0], durationMs: 380, keyframe: true },
        { kind: 'highlight', id: 'dimSecond', anchor: 'slotSecond', intensity: [0.8, 0], durationMs: 380, withPrevious: true },
        { kind: 'highlight', id: 'holdThird', anchor: 'slotThird', intensity: [0.8, 0.95], durationMs: 400, withPrevious: true },
        {
            kind: 'caption', id: 'unique',
            textKey: 'ponder.captions.pinnedCommands.unique',
            pointTo: { anchor: 'slotThird' }, durationMs: 6600, withPrevious: true,
        },
        { kind: 'pause', id: 'readUnique' },
    ],
};

/** 第二章：它们长在窗口下面那一排，而且和上面那份会自己重排的列表互不相干。 */
const versusRecent: PonderSceneScript = {
    id: 'pinned-commands-vs-recent',
    titleKey: 'ponder.scenes.pinnedCommandsVsRecent',
    anchors,
    steps: [
        { kind: 'surfaceState', id: 'showPalette', anchor: 'panel', state: 'palette-preview', transition: 'fade', durationMs: 520, keyframe: true },
        {
            kind: 'caption', id: 'where',
            textKey: 'ponder.captions.pinnedCommands.where',
            pointTo: { anchor: 'pinnedRow' }, durationMs: 6000, withPrevious: true,
        },
        { kind: 'pause', id: 'readWhere' },

        { kind: 'highlight', id: 'markList', anchor: 'paletteList', intensity: [0, 0.8], durationMs: 440, keyframe: true },
        {
            kind: 'caption', id: 'recent',
            textKey: 'ponder.captions.pinnedCommands.recent',
            pointTo: { anchor: 'paletteList' }, durationMs: 7200, withPrevious: true,
        },
        { kind: 'pause', id: 'readRecent' },

        { kind: 'highlight', id: 'dimList', anchor: 'paletteList', intensity: [0.8, 0], durationMs: 380, keyframe: true },
        { kind: 'highlight', id: 'markRow', anchor: 'pinnedRow', intensity: [0, 0.95], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'empty',
            textKey: 'ponder.captions.pinnedCommands.empty',
            pointTo: { anchor: 'pinnedRow' }, durationMs: 6200, withPrevious: true,
        },
        { kind: 'pause', id: 'readEmpty' },
    ],
};

export default {
    id: 'pinned-commands',
    titleKey: 'ponder.targets.pinnedCommands',
    category: 'basics',
    summaryKey: 'ponder.summaries.pinned_commands',
    hoverSelector: '[data-settings-row="pinnedCommandSlots"]',
    relatedTargetIds: ['command-palette', 'custom-shortcut-settings'],
    scenes: [theSlots, versusRecent],
} satisfies PonderTargetDefinition;
