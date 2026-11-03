import { CUSTOM_SHORTCUT_GEOMETRY as G } from '../../surfaces/settings/commandSettings.geometry';
import { settingsPanel, settingsRegion } from './settingsSectionShared';
import type { PonderAnchorSource, PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/settings/customShortcutSettings.target.ts
// 设置 · 快捷操作 · 命令窗口里的「自定义快捷键」。
//
// 这一组有两件事只写在代码里，界面上一个字都没有：
// 一是修饰键固定成 Alt —— 字段只收一颗字母，想录 Ctrl+Shift+X 那种组合是录不进去的；
// 二是命令下拉被 isScopeIndependentCommand 筛过 —— 只有「在哪儿都成立」的命令进得来，
// 所以在命令窗口里找得到的某条命令，在这里可能根本不在列表上，而屏幕上不会解释为什么。

const anchors = {
    panel: settingsPanel('custom-shortcut-settings', 'ponder.anchors.customShortcut.panel', { top: 0.24, width: 0.46, height: 0.36 }),
    capAlt: settingsRegion(G.capAlt, 'ponder.anchors.customShortcut.capAlt'),
    capKey: settingsRegion(G.capKey, 'ponder.anchors.customShortcut.capKey'),
    clear: settingsRegion(G.clear, 'ponder.anchors.customShortcut.clear'),
    command: settingsRegion(G.command, 'ponder.anchors.customShortcut.command'),
    commandList: settingsRegion(G.commandList, 'ponder.anchors.customShortcut.commandList'),
    rejection: settingsRegion(G.rejection, 'ponder.anchors.customShortcut.rejection'),
} satisfies Record<string, PonderAnchorSource>;

/** 第一章：Alt 是印死的，录的只有那一颗字母；被占掉的字母会被当场退回。 */
const theKey: PonderSceneScript = {
    id: 'custom-shortcut-key',
    titleKey: 'ponder.scenes.customShortcutKey',
    action: {
        kind: 'openSettings',
        anchorId: 'customShortcut',
        labelKey: 'ponder.actions.openCustomShortcut',
    },
    anchors,
    steps: [
        { kind: 'highlight', id: 'markAlt', anchor: 'capAlt', intensity: [0, 0.9], durationMs: 460, keyframe: true },
        {
            kind: 'caption', id: 'alt',
            textKey: 'ponder.captions.customShortcut.alt',
            pointTo: { anchor: 'capAlt' }, durationMs: 6400, withPrevious: true,
        },
        { kind: 'pause', id: 'readAlt' },

        { kind: 'highlight', id: 'dimAlt', anchor: 'capAlt', intensity: [0.9, 0], durationMs: 400, keyframe: true },
        { kind: 'cursor', id: 'focusSlot', to: { anchor: 'capKey' }, press: 'tap', durationMs: 620, withPrevious: true },
        { kind: 'highlight', id: 'markKey', anchor: 'capKey', intensity: [0, 0.9], durationMs: 420, withPrevious: true },
        { kind: 'keypress', id: 'pressLetter', keys: ['J'], at: { anchor: 'capKey', y: 0 }, durationMs: 900 },
        {
            kind: 'caption', id: 'capture',
            textKey: 'ponder.captions.customShortcut.capture',
            pointTo: { anchor: 'capKey' }, durationMs: 6000, withPrevious: true,
        },
        { kind: 'pause', id: 'readCapture' },

        // 被占掉的字母是这一章唯一会出错的地方，所以它要真的演一遍被退回。
        { kind: 'surfaceState', id: 'refuse', anchor: 'panel', state: 'key-refused', durationMs: 460, keyframe: true },
        {
            kind: 'caption', id: 'taken',
            textKey: 'ponder.captions.customShortcut.taken',
            pointTo: { anchor: 'rejection' }, durationMs: 6600, withPrevious: true,
        },
        { kind: 'pause', id: 'readTaken' },

        { kind: 'highlight', id: 'dimKey', anchor: 'capKey', intensity: [0.9, 0], durationMs: 380, keyframe: true },
        { kind: 'highlight', id: 'markClear', anchor: 'clear', intensity: [0, 0.9], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'clear',
            textKey: 'ponder.captions.customShortcut.clear',
            pointTo: { anchor: 'clear' }, durationMs: 5200, withPrevious: true,
        },
        { kind: 'pause', id: 'readClear' },
    ],
};

/** 第二章：右边那个下拉为什么比命令窗口里的列表短。 */
const theCommand: PonderSceneScript = {
    id: 'custom-shortcut-command',
    titleKey: 'ponder.scenes.customShortcutCommand',
    anchors,
    steps: [
        { kind: 'cursor', id: 'openList', to: { anchor: 'command' }, press: 'tap', durationMs: 640, keyframe: true },
        { kind: 'surfaceState', id: 'listOpens', anchor: 'panel', state: 'command-list', transition: 'slide-up', durationMs: 480 },
        {
            kind: 'caption', id: 'filtered',
            textKey: 'ponder.captions.customShortcut.filtered',
            pointTo: { anchor: 'commandList' }, durationMs: 7000, withPrevious: true,
        },
        { kind: 'pause', id: 'readFiltered' },

        { kind: 'highlight', id: 'markList', anchor: 'commandList', intensity: [0, 0.75], durationMs: 440, keyframe: true },
        {
            kind: 'caption', id: 'goesQuiet',
            textKey: 'ponder.captions.customShortcut.goesQuiet',
            pointTo: { anchor: 'commandList' }, durationMs: 6800, withPrevious: true,
        },
        { kind: 'pause', id: 'readGoesQuiet' },
    ],
};

export default {
    id: 'custom-shortcut-settings',
    titleKey: 'ponder.targets.customShortcutSettings',
    category: 'basics',
    summaryKey: 'ponder.summaries.custom_shortcut_settings',
    hoverSelector: '[data-settings-row="customShortcut"]',
    relatedTargetIds: ['command-palette', 'pinned-commands', 'folia-shortcuts'],
    scenes: [theKey, theCommand],
} satisfies PonderTargetDefinition;
