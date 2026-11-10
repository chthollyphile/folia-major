import { GRID_HOTKEY_GEOMETRY as G } from '../../surfaces/settings/playbackSettings.geometry';
import { settingsPanel, settingsRegion } from './settingsSectionShared';
import type { PonderAnchorSource, PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/settings/gridPaletteHotkey.target.ts
// 设置 · 快捷操作 · 海报墙里的「海报墙上用 S 键打开命令窗口」。
//
// 只是一行开关，但它决定的是同一个键在网格页上做哪件事 —— 而这件事屏幕上
// 没有任何提示。默认关着：网格页上任何单字符都进筛选框，S 也不例外。

const anchors = {
    panel: settingsPanel('grid-hotkey-settings', 'ponder.anchors.gridHotkey.panel', { top: 0.3, width: 0.44, height: 0.25 }),
    toggle: settingsRegion(G.toggle, 'ponder.anchors.gridHotkey.toggle'),
} satisfies Record<string, PonderAnchorSource>;

const whoOwnsS: PonderSceneScript = {
    id: 'grid-palette-hotkey-owner',
    titleKey: 'ponder.scenes.gridPaletteHotkeyOwner',
    action: {
        kind: 'openSettings',
        anchorId: 'gridPaletteHotkey',
        labelKey: 'ponder.actions.openGridPaletteHotkey',
    },
    anchors,
    steps: [
        { kind: 'keypress', id: 'typeS', keys: ['S'], at: { anchor: 'panel', y: 0, offset: { y: -24 } }, durationMs: 1000, keyframe: true },
        { kind: 'highlight', id: 'markToggle', anchor: 'toggle', intensity: [0, 0.8], durationMs: 460, withPrevious: true },
        {
            kind: 'caption', id: 'off',
            textKey: 'ponder.captions.gridHotkey.off',
            pointTo: { anchor: 'toggle' }, durationMs: 6600, withPrevious: true,
        },
        { kind: 'pause', id: 'readOff' },

        { kind: 'cursor', id: 'turnOn', to: { anchor: 'toggle', x: 0.93 }, press: 'tap', durationMs: 620, keyframe: true },
        { kind: 'surfaceState', id: 'switchOn', anchor: 'panel', state: 'hotkey-on', durationMs: 440 },
        {
            kind: 'caption', id: 'on',
            textKey: 'ponder.captions.gridHotkey.on',
            pointTo: { anchor: 'toggle' }, durationMs: 6400, withPrevious: true,
        },
        { kind: 'pause', id: 'readOn' },
    ],
};

export default {
    id: 'grid-palette-hotkey',
    titleKey: 'ponder.targets.gridPaletteHotkey',
    category: 'browsing',
    summaryKey: 'ponder.summaries.grid_palette_hotkey',
    hoverSelector: '[data-settings-row="gridPaletteHotkey"]',
    relatedTargetIds: ['grid-page', 'command-palette'],
    scenes: [whoOwnsS],
} satisfies PonderTargetDefinition;
