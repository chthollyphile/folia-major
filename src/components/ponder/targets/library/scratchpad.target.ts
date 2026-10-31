import {
    SCRATCHPAD_CANVAS as C,
    SCRATCHPAD_CARD as K,
    SCRATCHPAD_DRAG,
    SCRATCHPAD_DRAWER as D,
    SCRATCHPAD_GEOMETRY as G,
    SCRATCHPAD_HOVER_ROW,
    scratchpadCanvasHeaderRect,
    scratchpadCanvasSlotRect,
    scratchpadGroupActionsRect,
    scratchpadGroupHeaderRect,
    scratchpadRowActionsRect,
    scratchpadRowRect,
} from '../../surfaces/library/scratchpad.geometry';
import type { PonderAnchorSource, PonderRelativeRect, PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/library/scratchpad.target.ts
// 速记簿：从左缘滑出来的歌曲暂存区。
//
// 单独成目标的理由：入口全藏在悬停后面（磁贴、曲目行、搜索结果右上角的那颗只在指针停着时出现），
// 把手平时只是左缘的一道细线（速记簿空着时整个看不见），指针移到左缘上部才展开；放进去的歌不进播放队列，处理过也不会自己消失；
// 分组按的是来源而不是出处，因为一个歌单只收一个来源的歌；画布里的拖动只在组内、松手吸附。
// 这些在画面上都看不出来。
//
// 几何来自 scratchpad.geometry，和 scratchpad.surface.tsx 画的是同一组数。

const page = {
    kind: 'synthetic',
    // aspect 是 900 ÷ 1440：画的是一整页，抽屉和画布按它们在页面里的真实比例盖在上面。
    rect: { left: 0.5, top: 0.09, width: 0.6, height: 0.6, aspect: 0.625, anchorX: 'center' },
    role: 'surface',
    surfaceKind: 'scratchpad',
    labelKey: 'ponder.anchors.scratchpad.page',
} satisfies PonderAnchorSource;

const region = (from: string, rect: PonderRelativeRect, labelKey: string): PonderAnchorSource => (
    { kind: 'relative', from, rect, role: 'region', labelKey }
);

const { group: hoverGroup, row: hoverRow } = SCRATCHPAD_HOVER_ROW;

const anchors = {
    page,
    handle: region('page', G.handle, 'ponder.anchors.scratchpad.handle'),
    card: region('page', G.card, 'ponder.anchors.scratchpad.card'),
    collect: region('card', K.collect, 'ponder.anchors.scratchpad.collect'),
    save: region('card', K.save, 'ponder.anchors.scratchpad.save'),
    drawer: region('page', G.drawer, 'ponder.anchors.scratchpad.drawer'),
    group: region('drawer', scratchpadGroupHeaderRect(0), 'ponder.anchors.scratchpad.group'),
    groupActions: region('drawer', scratchpadGroupActionsRect(0), 'ponder.anchors.scratchpad.groupActions'),
    row: region('drawer', scratchpadRowRect(hoverGroup, hoverRow), 'ponder.anchors.scratchpad.row'),
    rowActions: region('drawer', scratchpadRowActionsRect(hoverGroup, hoverRow), 'ponder.anchors.scratchpad.rowActions'),
    footer: region('drawer', D.footer, 'ponder.anchors.scratchpad.footer'),
    expand: region('drawer', D.expand, 'ponder.anchors.scratchpad.expand'),
    canvas: region('page', G.canvas, 'ponder.anchors.scratchpad.canvas'),
    canvasGroup: region('canvas', scratchpadCanvasHeaderRect(0), 'ponder.anchors.scratchpad.canvasGroup'),
    dragFrom: region('canvas', scratchpadCanvasSlotRect(SCRATCHPAD_DRAG.group, SCRATCHPAD_DRAG.from), 'ponder.anchors.scratchpad.card'),
    dragTo: region('canvas', scratchpadCanvasSlotRect(SCRATCHPAD_DRAG.group, SCRATCHPAD_DRAG.to), 'ponder.anchors.scratchpad.slot'),
    marquee: region('canvas', C.marquee, 'ponder.anchors.scratchpad.marquee'),
    selection: region('canvas', C.selectionBar, 'ponder.anchors.scratchpad.selection'),
} satisfies Record<string, PonderAnchorSource>;

/** 第一章：指针停在一张歌曲磁贴上，右上角出两颗；点左边那颗，这首就进了速记簿，把手上多出首数。 */
const collect: PonderSceneScript = {
    id: 'scratchpad-collect',
    titleKey: 'ponder.scenes.scratchpadCollect',
    anchors,
    steps: [
        { kind: 'cursor', id: 'hoverCard', to: { anchor: 'card', x: 0.45, y: 0.55 }, durationMs: 700, keyframe: true },
        { kind: 'surfaceState', id: 'buttonsAppear', anchor: 'page', state: 'card-hover', durationMs: 360 },
        { kind: 'highlight', id: 'markCollect', anchor: 'collect', intensity: [0, 0.9], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'hover',
            textKey: 'ponder.captions.scratchpad.hover',
            pointTo: { anchor: 'collect' }, durationMs: 6600, withPrevious: true,
        },
        { kind: 'pause', id: 'readHover' },

        { kind: 'highlight', id: 'dimCollect', anchor: 'collect', intensity: [0.9, 0], durationMs: 380, keyframe: true },
        { kind: 'highlight', id: 'markSave', anchor: 'save', intensity: [0, 0.9], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'save',
            textKey: 'ponder.captions.scratchpad.save',
            pointTo: { anchor: 'save' }, durationMs: 6000, withPrevious: true,
        },
        { kind: 'pause', id: 'readSave' },

        { kind: 'highlight', id: 'dimSave', anchor: 'save', intensity: [0.9, 0], durationMs: 380, keyframe: true },
        { kind: 'cursor', id: 'pressCollect', to: { anchor: 'collect' }, press: 'tap', durationMs: 620, withPrevious: true },
        { kind: 'surfaceState', id: 'collected', anchor: 'page', state: 'collected', durationMs: 420 },
        { kind: 'highlight', id: 'markHandle', anchor: 'handle', intensity: [0, 0.9], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'notQueue',
            textKey: 'ponder.captions.scratchpad.notQueue',
            pointTo: { anchor: 'handle' }, durationMs: 7000, withPrevious: true,
        },
        { kind: 'pause', id: 'readNotQueue' },

        { kind: 'keypress', id: 'jotCurrent', keys: [':', 'S'], at: { anchor: 'page', y: 1, offset: { y: 18 } }, durationMs: 1200, keyframe: true },
        {
            kind: 'caption', id: 'otherWays',
            textKey: 'ponder.captions.scratchpad.otherWays',
            durationMs: 7400, withPrevious: true,
        },
        { kind: 'pause', id: 'readOtherWays' },
    ],
};

/** 第二章：打开抽屉。按来源分组；组头和每一行右端的按钮；最底下一排。 */
const drawer: PonderSceneScript = {
    id: 'scratchpad-drawer',
    titleKey: 'ponder.scenes.scratchpadDrawer',
    anchors,
    steps: [
        { kind: 'highlight', id: 'markHandle', anchor: 'handle', intensity: [0, 0.8], durationMs: 420, keyframe: true },
        { kind: 'keypress', id: 'modJ', keys: ['Mod J'], at: { anchor: 'page', y: 1, offset: { y: 18 } }, durationMs: 1000, withPrevious: true },
        { kind: 'surfaceState', id: 'drawerOpens', anchor: 'page', state: 'drawer', transition: 'fade', durationMs: 460 },
        { kind: 'highlight', id: 'dimHandle', anchor: 'handle', intensity: [0.8, 0], durationMs: 300, withPrevious: true },
        {
            kind: 'caption', id: 'open',
            textKey: 'ponder.captions.scratchpad.open',
            pointTo: { anchor: 'drawer' }, durationMs: 6800, withPrevious: true,
        },
        { kind: 'pause', id: 'readOpen' },

        { kind: 'highlight', id: 'markGroup', anchor: 'group', intensity: [0, 0.6], durationMs: 420, keyframe: true },
        {
            kind: 'caption', id: 'groups',
            textKey: 'ponder.captions.scratchpad.groups',
            pointTo: { anchor: 'group' }, durationMs: 7400, withPrevious: true,
        },
        { kind: 'pause', id: 'readGroups' },

        { kind: 'highlight', id: 'dimGroup', anchor: 'group', intensity: [0.6, 0], durationMs: 360, keyframe: true },
        { kind: 'highlight', id: 'markGroupActions', anchor: 'groupActions', intensity: [0, 0.9], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'groupActions',
            textKey: 'ponder.captions.scratchpad.groupActions',
            pointTo: { anchor: 'groupActions' }, durationMs: 6600, withPrevious: true,
        },
        { kind: 'pause', id: 'readGroupActions' },

        { kind: 'highlight', id: 'dimGroupActions', anchor: 'groupActions', intensity: [0.9, 0], durationMs: 360, keyframe: true },
        { kind: 'cursor', id: 'hoverRow', to: { anchor: 'row', x: 0.3 }, durationMs: 620, withPrevious: true },
        { kind: 'surfaceState', id: 'rowHover', anchor: 'page', state: 'row-hover', durationMs: 320 },
        { kind: 'highlight', id: 'markRowActions', anchor: 'rowActions', intensity: [0, 0.9], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'rowActions',
            textKey: 'ponder.captions.scratchpad.rowActions',
            pointTo: { anchor: 'rowActions' }, durationMs: 7600, withPrevious: true,
        },
        { kind: 'pause', id: 'readRowActions' },

        { kind: 'highlight', id: 'dimRowActions', anchor: 'rowActions', intensity: [0.9, 0], durationMs: 360, keyframe: true },
        { kind: 'highlight', id: 'markFooter', anchor: 'footer', intensity: [0, 0.8], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'footer',
            textKey: 'ponder.captions.scratchpad.footer',
            pointTo: { anchor: 'footer' }, durationMs: 7000, withPrevious: true,
        },
        { kind: 'pause', id: 'readFooter' },
    ],
};

/** 第三章：展开成画布。组内拖动、松手吸附；在空白处拖出框来多选，最底下一排换成对选中的那几颗。 */
const canvas: PonderSceneScript = {
    id: 'scratchpad-canvas',
    titleKey: 'ponder.scenes.scratchpadCanvas',
    anchors,
    steps: [
        { kind: 'surfaceState', id: 'drawerOpen', anchor: 'page', state: 'drawer', durationMs: 380, keyframe: true },
        { kind: 'highlight', id: 'markExpand', anchor: 'expand', intensity: [0, 0.9], durationMs: 420 },
        {
            kind: 'caption', id: 'expand',
            textKey: 'ponder.captions.scratchpad.expand',
            pointTo: { anchor: 'expand' }, durationMs: 4200, withPrevious: true,
        },
        { kind: 'pause', id: 'readExpand' },

        { kind: 'highlight', id: 'dimExpand', anchor: 'expand', intensity: [0.9, 0], durationMs: 300, keyframe: true },
        { kind: 'cursor', id: 'pressExpand', to: { anchor: 'expand' }, press: 'tap', durationMs: 660, withPrevious: true },
        { kind: 'surfaceState', id: 'canvasOpens', anchor: 'page', state: 'canvas', transition: 'zoom', durationMs: 520 },
        { kind: 'highlight', id: 'markCanvasGroup', anchor: 'canvasGroup', intensity: [0, 0.5], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'canvas',
            textKey: 'ponder.captions.scratchpad.canvas',
            pointTo: { anchor: 'canvasGroup' }, durationMs: 6400, withPrevious: true,
        },
        { kind: 'pause', id: 'readCanvas' },

        { kind: 'highlight', id: 'dimCanvasGroup', anchor: 'canvasGroup', intensity: [0.5, 0], durationMs: 360, keyframe: true },
        { kind: 'drag', id: 'dragCard', from: { anchor: 'dragFrom', y: 0.35 }, to: { anchor: 'dragTo', y: 0.35 }, durationMs: 1100 },
        { kind: 'surfaceState', id: 'reordered', anchor: 'page', state: 'canvas-reordered', durationMs: 360 },
        { kind: 'highlight', id: 'markSlot', anchor: 'dragTo', intensity: [0, 0.8], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'drag',
            textKey: 'ponder.captions.scratchpad.drag',
            pointTo: { anchor: 'dragTo' }, durationMs: 7000, withPrevious: true,
        },
        { kind: 'pause', id: 'readDrag' },

        { kind: 'highlight', id: 'dimSlot', anchor: 'dragTo', intensity: [0.8, 0], durationMs: 360, keyframe: true },
        { kind: 'drag', id: 'drawMarquee', from: { anchor: 'marquee', x: 0, y: 0 }, to: { anchor: 'marquee', x: 1, y: 1 }, durationMs: 1000 },
        { kind: 'surfaceState', id: 'selected', anchor: 'page', state: 'canvas-selected', durationMs: 360 },
        { kind: 'highlight', id: 'markSelection', anchor: 'selection', intensity: [0, 0.6], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'select',
            textKey: 'ponder.captions.scratchpad.select',
            pointTo: { anchor: 'selection' }, durationMs: 7600, withPrevious: true,
        },
        { kind: 'pause', id: 'readSelect' },
    ],
};

export default {
    id: 'scratchpad',
    titleKey: 'ponder.targets.scratchpad',
    category: 'browsing',
    summaryKey: 'ponder.summaries.scratchpad',
    // 左缘的把手和打开的抽屉（含展开成的画布）都挂 data-ponder="scratchpad"。
    hoverSelector: '[data-ponder="scratchpad"]',
    relatedTargetIds: ['command-palette'],
    scenes: [collect, drawer, canvas],
} satisfies PonderTargetDefinition;
