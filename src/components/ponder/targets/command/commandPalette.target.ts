import type { PonderAnchorSource, PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/command/commandPalette.target.ts
// 命令窗口本身，作为一个可单独思索的组件。
//
// 和播放页那一章的分工：播放页讲「它在哪、怎么叫出来」，这里讲「叫出来之后它怎么用」。
// 三章对应它真正的三种用法 —— 挑一条命令执行、给一条命令带参数、用 `:` 一个键跑完。
//
// 窗口画成整屏居中的一块，而不是嵌在播放页里：这里讲的是窗口里面怎么用，哪个页面都一样，
// 摆进某个页面反而暗示它只属于那一页。画的是没有控制条时那种从上方落下、输入行在顶的样子；
// 控制条在屏幕上时它从控制条长出来、输入行在底、结果倒排，那一种在 player-bar 和 player-page 两处教程里讲。

const palette = {
    kind: 'synthetic',
    rect: { left: 0.5, top: 0.16, width: 0.52, height: 0.5, anchorX: 'center' },
    role: 'surface',
    surfaceKind: 'palette',
    labelKey: 'ponder.anchors.pages.commandPalette',
} satisfies PonderAnchorSource;

const anchors = {
    palette,
    /** 顶上那条输入行。命令是搜出来的，不是翻出来的，所以一切都从这里开始。 */
    input: {
        kind: 'relative', from: 'palette',
        rect: { left: 0.04, right: 0.04, top: 0.03, height: 0.16 },
        role: 'region', labelKey: 'ponder.anchors.commandPalette.input',
    },
    /** 输入行下面的结果列表。 */
    results: {
        kind: 'relative', from: 'palette',
        rect: { left: 0.04, right: 0.04, top: 0.24, bottom: 0.04 },
        role: 'region', labelKey: 'ponder.anchors.commandPalette.results',
    },
    /** 结果里的第一条，回车执行的就是它。 */
    firstResult: {
        kind: 'relative', from: 'palette',
        rect: { left: 0.04, right: 0.04, top: 0.26, height: 0.2 },
        role: 'region', labelKey: 'ponder.anchors.commandPalette.firstResult',
    },
} satisfies PonderSceneScript['anchors'];

/** 第一章：搜出来，回车执行。 */
const searchAndRun: PonderSceneScript = {
    id: 'command-palette-search',
    titleKey: 'ponder.scenes.commandPaletteSearch',
    anchors,
    steps: [
        { kind: 'highlight', id: 'markInput', anchor: 'input', intensity: [0, 0.7], durationMs: 420, keyframe: true },
        {
            kind: 'caption', id: 'type',
            textKey: 'ponder.captions.commandPalette.type',
            pointTo: { anchor: 'input' }, durationMs: 5000, withPrevious: true,
        },
        { kind: 'pause', id: 'readType' },

        { kind: 'highlight', id: 'markFirst', anchor: 'firstResult', intensity: [0, 0.85], durationMs: 420, keyframe: true },
        { kind: 'keypress', id: 'enter', keys: ['↑', '↓', 'Enter'], at: { anchor: 'results', y: 1, offset: { y: 16 } }, durationMs: 1200, withPrevious: true },
        {
            kind: 'caption', id: 'run',
            textKey: 'ponder.captions.commandPalette.run',
            pointTo: { anchor: 'firstResult' }, durationMs: 4800, withPrevious: true,
        },
        { kind: 'pause', id: 'readRun' },
    ],
};

/** 第二章：需要参数的命令会变成一枚 pill，窗口留在原地继续收参数。 */
const argumentMode: PonderSceneScript = {
    id: 'command-palette-argument',
    titleKey: 'ponder.scenes.commandPaletteArgument',
    anchors,
    steps: [
        { kind: 'highlight', id: 'markInput', anchor: 'input', intensity: [0, 0.7], durationMs: 420, keyframe: true },
        { kind: 'keypress', id: 'space', keys: ['命令名', '空格'], at: { anchor: 'input', y: 1, offset: { y: 16 } }, durationMs: 1200, withPrevious: true },
        {
            kind: 'caption', id: 'pill',
            textKey: 'ponder.captions.commandPalette.pill',
            pointTo: { anchor: 'input' }, durationMs: 5600, withPrevious: true,
        },
        { kind: 'pause', id: 'readPill' },

        { kind: 'keypress', id: 'flagKeys', keys: ['--'], at: { anchor: 'results', y: 0, offset: { y: -14 } }, durationMs: 1000, keyframe: true },
        {
            kind: 'caption', id: 'flags',
            textKey: 'ponder.captions.commandPalette.flags',
            pointTo: { anchor: 'results' }, durationMs: 5400, withPrevious: true,
        },
        { kind: 'pause', id: 'readFlags' },
    ],
};

/**
 * 第三章：`:` 进执行模式，一个键跑完一条命令。
 *
 * `:` 是**窗口关着时**按的：它在 executeModeCommand 里声明成不带修饰键的 openHotkey，
 * 而 useCommandPalette 会把这类裸键在焦点落在输入框时全部让路（isTextEntryTarget）。
 * 所以 keypress 不能落在输入行上 —— 画在那儿读起来就是「在这个框里打一个冒号」，
 * 而那样做只会往查询里插一个冒号。
 */
const executeMode: PonderSceneScript = {
    id: 'command-palette-execute-mode',
    titleKey: 'ponder.scenes.commandPaletteExecuteMode',
    anchors,
    steps: [
        { kind: 'keypress', id: 'colon', keys: [':'], at: { anchor: 'palette', y: 0, offset: { y: -28 } }, durationMs: 1000, keyframe: true },
        { kind: 'highlight', id: 'markResults', anchor: 'results', intensity: [0, 0.6], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'enter',
            textKey: 'ponder.captions.commandPalette.executeEnter',
            pointTo: { anchor: 'input' }, durationMs: 5200, withPrevious: true,
        },
        { kind: 'pause', id: 'readEnter' },

        { kind: 'keypress', id: 'shortcutKeys', keys: ['r', 'v', 'o', 'h'], at: { anchor: 'results', y: 1, offset: { y: 16 } }, durationMs: 1400, keyframe: true },
        {
            kind: 'caption', id: 'keys',
            textKey: 'ponder.captions.commandPalette.executeKeys',
            pointTo: { anchor: 'results' }, durationMs: 5600, withPrevious: true,
        },
        { kind: 'pause', id: 'readKeys' },
    ],
};

export default {
    id: 'command-palette',
    titleKey: 'ponder.targets.commandPalette',
    category: 'basics',
    summaryKey: 'ponder.summaries.command_palette',
    // 窗口开着的时候才指得到它；关着时从别处的「本页可单独思索的组件」进来。
    hoverSelector: '[data-testid="command-palette-panel"]',
    relatedTargetIds: ['panel-slide'],
    scenes: [searchAndRun, argumentMode, executeMode],
} satisfies PonderTargetDefinition;
