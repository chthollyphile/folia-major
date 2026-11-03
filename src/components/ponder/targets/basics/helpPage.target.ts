import { ONBOARDING_ILLUSTRATION } from './ponderOnboardingShared';
import type { PonderAnchorSource, PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/basics/helpPage.target.ts
// Folia 的总览。第一次打开应用时那道门指向它，思索导航页上按 Ctrl+G 也是它。
//
// 这里只放四个最短的入门章节：思索、命令面板、常用操作示例和官方文档。
// 媒体键、完整快捷键、桌面端等细节仍各自作为导航页上的独立目标。

const palette = {
    kind: 'synthetic',
    rect: { left: 0.5, top: 0.16, width: 0.52, height: 0.5, anchorX: 'center' },
    role: 'surface',
    surfaceKind: 'palette',
    labelKey: 'ponder.anchors.pages.commandPalette',
} satisfies PonderAnchorSource;

const commandPaletteAnchors = {
    palette,
    input: {
        kind: 'relative', from: 'palette',
        rect: { left: 0.04, right: 0.04, top: 0.03, height: 0.16 },
        role: 'region', labelKey: 'ponder.anchors.commandPalette.input',
    },
    results: {
        kind: 'relative', from: 'palette',
        rect: { left: 0.04, right: 0.04, top: 0.24, bottom: 0.04 },
        role: 'region', labelKey: 'ponder.anchors.commandPalette.results',
    },
} satisfies PonderSceneScript['anchors'];

const commandExampleAnchors = {
    volume: {
        kind: 'synthetic',
        rect: { left: 0.18, top: 0.23, width: 0.26, height: 0.24, anchorX: 'center' },
        role: 'surface', surfaceKind: 'volume', labelKey: 'ponder.anchors.playerBar.volumeSurface',
    },
    queueSearch: {
        kind: 'synthetic',
        rect: { left: 0.5, top: 0.17, width: 0.28, height: 0.38, anchorX: 'center' },
        role: 'surface', surfaceKind: 'queue-command', labelKey: 'ponder.anchors.queueCommand.panel',
    },
    playlistFilter: {
        kind: 'synthetic',
        rect: { left: 0.82, top: 0.17, width: 0.32, height: 0.38, anchorX: 'center' },
        role: 'surface', surfaceKind: 'grid-view-page', labelKey: 'ponder.anchors.pages.gridView',
    },
} satisfies PonderSceneScript['anchors'];

/**
 * 第一章：两种思索入口，以及不需要时可以关闭。
 *
 * 先讲 Ctrl+G：它不依赖任何组件，在哪一页都能用，是最先该记住的那一下。
 * 然后才是悬停提示和长按 G。每一步单独一段字幕，停留比默认长，不把两件事塞进一句。
 * 结果层只能淡入、不能退回 base，所以 ponder-open 必须放在最后。
 */
const ponderOverview: PonderSceneScript = {
    id: 'help-page-overview',
    titleKey: 'ponder.scenes.helpPageOverview',
    action: {
        kind: 'openSettings',
        anchorId: 'ponderHints',
        labelKey: 'ponder.actions.openPonderHints',
    },
    anchors: ONBOARDING_ILLUSTRATION,
    steps: [
        { kind: 'keypress', id: 'pressCtrlG', keys: ['Ctrl G'], at: { anchor: 'page', y: 1, offset: { y: 20 } }, durationMs: 1400, keyframe: true },
        { kind: 'highlight', id: 'markPage', anchor: 'page', intensity: [0, 0.35], durationMs: 520, withPrevious: true },
        {
            kind: 'caption', id: 'ctrlG',
            textKey: 'ponder.captions.onboarding.overviewCtrlG',
            pointTo: { anchor: 'page' }, durationMs: 6000, withPrevious: true,
        },
        { kind: 'pause', id: 'readCtrlG', dwellMs: 2200 },

        {
            kind: 'caption', id: 'wholePage',
            textKey: 'ponder.captions.onboarding.overviewWholePage',
            pointTo: { anchor: 'page' }, durationMs: 6400, keyframe: true,
        },
        { kind: 'pause', id: 'readWholePage', dwellMs: 2200 },

        { kind: 'highlight', id: 'dimPage', anchor: 'page', intensity: [0.35, 0], durationMs: 480, keyframe: true },
        { kind: 'cursor', id: 'hoverComponent', to: { anchor: 'component' }, durationMs: 1000, withPrevious: true },
        { kind: 'surfaceState', id: 'showHint', anchor: 'page', state: 'hint-shown', durationMs: 520 },
        {
            kind: 'caption', id: 'hover',
            textKey: 'ponder.captions.onboarding.overviewHover',
            pointTo: { anchor: 'capsule' }, durationMs: 6400, withPrevious: true,
        },
        { kind: 'pause', id: 'readHover', dwellMs: 2200 },

        { kind: 'keypress', id: 'holdG', keys: ['G'], at: { anchor: 'capsule', y: 1, offset: { y: 20 } }, durationMs: 1400, keyframe: true },
        { kind: 'surfaceState', id: 'holding', anchor: 'page', state: 'hint-holding', durationMs: 900, withPrevious: true },
        { kind: 'surfaceState', id: 'opened', anchor: 'page', state: 'ponder-open', transition: 'zoom', durationMs: 640 },
        {
            kind: 'caption', id: 'hold',
            textKey: 'ponder.captions.onboarding.overviewHold',
            pointTo: { anchor: 'page' }, durationMs: 6400, withPrevious: true,
        },
        { kind: 'pause', id: 'readHold', dwellMs: 2200 },

        {
            kind: 'caption', id: 'settings',
            textKey: 'ponder.captions.onboarding.overviewSettings',
            pointTo: { anchor: 'page' }, durationMs: 6000, keyframe: true,
        },
        { kind: 'pause', id: 'readSettings', dwellMs: 2200 },
    ],
};

/** 第二章：命令面板是跨页面的主要操作入口。 */
const commandPalette: PonderSceneScript = {
    id: 'help-page-command-palette',
    titleKey: 'ponder.scenes.helpPageCommandPalette',
    anchors: commandPaletteAnchors,
    steps: [
        { kind: 'keypress', id: 'openPalette', keys: ['Mod K'], at: { anchor: 'palette', y: 0, offset: { y: -24 } }, durationMs: 1000, keyframe: true },
        { kind: 'highlight', id: 'markInput', anchor: 'input', intensity: [0, 0.75], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'palette',
            textKey: 'ponder.captions.onboarding.overviewCommandPalette',
            pointTo: { anchor: 'input' }, durationMs: 6800, withPrevious: true,
        },
        { kind: 'pause', id: 'readPalette' },
    ],
};

/** 第三章：用音量、队列搜索和当前歌单二次检索说明命令面板的用法。 */
const commandExamples: PonderSceneScript = {
    id: 'help-page-command-examples',
    titleKey: 'ponder.scenes.helpPageCommandExamples',
    anchors: commandExampleAnchors,
    steps: [
        { kind: 'highlight', id: 'markVolume', anchor: 'volume', intensity: [0, 0.7], durationMs: 420, keyframe: true },
        {
            kind: 'caption', id: 'volume',
            textKey: 'ponder.captions.onboarding.overviewExampleVolume',
            pointTo: { anchor: 'volume' }, durationMs: 3600, withPrevious: true,
        },
        { kind: 'pause', id: 'readVolume' },

        { kind: 'highlight', id: 'dimVolume', anchor: 'volume', intensity: [0.7, 0], durationMs: 360, keyframe: true },
        { kind: 'highlight', id: 'markQueue', anchor: 'queueSearch', intensity: [0, 0.7], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'queue',
            textKey: 'ponder.captions.onboarding.overviewExampleQueue',
            pointTo: { anchor: 'queueSearch' }, durationMs: 3600, withPrevious: true,
        },
        { kind: 'pause', id: 'readQueue' },

        { kind: 'highlight', id: 'dimQueue', anchor: 'queueSearch', intensity: [0.7, 0], durationMs: 360, keyframe: true },
        { kind: 'surfaceState', id: 'filterOpen', anchor: 'playlistFilter', state: 'filter-open', transition: 'slide-up', durationMs: 520, withPrevious: true },
        { kind: 'highlight', id: 'markFilter', anchor: 'playlistFilter', intensity: [0, 0.7], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'filter',
            textKey: 'ponder.captions.onboarding.overviewExampleFilter',
            pointTo: { anchor: 'playlistFilter' }, durationMs: 4800, withPrevious: true,
        },
        { kind: 'pause', id: 'readFilter' },
    ],
};

/** 第四章：从底部动作直达官方文档。 */
const docs: PonderSceneScript = {
    id: 'help-page-docs',
    titleKey: 'ponder.scenes.helpPageDocs',
    action: {
        kind: 'openUrl',
        url: 'https://folia-site.cielaniska.top/guide/',
        labelKey: 'ponder.actions.openDocs',
    },
    anchors: ONBOARDING_ILLUSTRATION,
    steps: [
        { kind: 'highlight', id: 'showPage', anchor: 'page', intensity: [0, 0.35], durationMs: 520, keyframe: true },
        {
            kind: 'caption', id: 'docs',
            textKey: 'ponder.captions.onboarding.overviewDocs',
            pointTo: { anchor: 'page' }, durationMs: 5600, withPrevious: true,
        },
        { kind: 'pause', id: 'readDocs' },
    ],
};

export default {
    id: 'help-page',
    titleKey: 'ponder.targets.helpPage',
    category: 'basics',
    summaryKey: 'ponder.summaries.help_page',
    hoverSelector: null,
    scenes: [ponderOverview, commandPalette, commandExamples, docs],
} satisfies PonderTargetDefinition;
