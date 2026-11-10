import { SIDE_PANEL_ANCHORS } from './sidePanelShared';
import type { PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/panel/sidePanel.target.ts
// 右侧展开的控制面板，整块。
//
// 和 panel-slide 的分工：那个目标讲的是「那颗按钮还能往左滑」，这里讲的是「按钮按开之后
// 这块面板是怎么搭的」。两件事的入口是同一颗按钮，但学的是不同的东西。
//
// 这个目标只回答结构问题：面板分几段、怎么换页。封面下面那一行按钮和几个标签页各有
// 自己的目标 —— 悬停在哪儿就讲哪儿，不必先看完整块面板的六章才轮到你要问的那一页。
//
// 几何来自 sidePanel.geometry，和 sidePanel.surface.tsx 画的是同一组数。

const anchors = SIDE_PANEL_ANCHORS;

/** 第一章：面板从上到下是这首歌、当前这一页的内容、最底下一排标签。 */
const structure: PonderSceneScript = {
    id: 'side-panel-structure',
    titleKey: 'ponder.scenes.sidePanelStructure',
    anchors,
    steps: [
        { kind: 'highlight', id: 'markCover', anchor: 'cover', intensity: [0, 0.6], durationMs: 420, keyframe: true },
        {
            kind: 'caption', id: 'cover',
            textKey: 'ponder.captions.sidePanel.cover',
            pointTo: { anchor: 'cover' }, durationMs: 5200, withPrevious: true,
        },
        { kind: 'pause', id: 'readCover' },

        { kind: 'highlight', id: 'dimCover', anchor: 'cover', intensity: [0.6, 0], durationMs: 400, keyframe: true },
        { kind: 'highlight', id: 'markTabs', anchor: 'tabs', intensity: [0, 0.85], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'tabs',
            textKey: 'ponder.captions.sidePanel.tabs',
            pointTo: { anchor: 'tabs' }, durationMs: 5800, withPrevious: true,
        },
        { kind: 'pause', id: 'readTabs' },

        // 换到控制页：顶上那首歌收成一行，中间才有这一页的内容。
        { kind: 'highlight', id: 'dimTabs', anchor: 'tabs', intensity: [0.85, 0], durationMs: 400, keyframe: true },
        { kind: 'surfaceState', id: 'toControls', anchor: 'panel', state: 'controls-tab', durationMs: 460, withPrevious: true },
        { kind: 'highlight', id: 'markHeader', anchor: 'header', intensity: [0, 0.7], durationMs: 420 },
        { kind: 'highlight', id: 'markBody', anchor: 'body', intensity: [0, 0.5], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'body',
            textKey: 'ponder.captions.sidePanel.body',
            pointTo: { anchor: 'body' }, durationMs: 6400, withPrevious: true,
        },
        { kind: 'pause', id: 'readBody' },
    ],
};

/** 第二章：Tab 键在标签页之间循环，不必去点那一排小格子。从封面页往后一格是来源那一页。 */
const cycleTabs: PonderSceneScript = {
    id: 'side-panel-tabs',
    titleKey: 'ponder.scenes.sidePanelTabs',
    anchors,
    steps: [
        { kind: 'highlight', id: 'markTabs', anchor: 'tabs', intensity: [0, 0.8], durationMs: 420, keyframe: true },
        { kind: 'keypress', id: 'tabKey', keys: ['Tab'], at: { anchor: 'tabs', y: 0, offset: { y: -16 } }, durationMs: 900, withPrevious: true },
        { kind: 'surfaceState', id: 'toSource', anchor: 'panel', state: 'source-tab', durationMs: 460 },
        {
            kind: 'caption', id: 'cycle',
            textKey: 'ponder.captions.sidePanel.cycle',
            pointTo: { anchor: 'tabs' }, durationMs: 5600, withPrevious: true,
        },
        { kind: 'pause', id: 'readCycle' },

        { kind: 'keypress', id: 'shiftTabKey', keys: ['Shift Tab'], at: { anchor: 'tabs', y: 0, offset: { y: -16 } }, durationMs: 1000, keyframe: true },
        { kind: 'surfaceState', id: 'backToCover', anchor: 'panel', state: 'cover-tab', durationMs: 460 },
        {
            kind: 'caption', id: 'reverse',
            textKey: 'ponder.captions.sidePanel.cycleReverse',
            pointTo: { anchor: 'tabs' }, durationMs: 5400, withPrevious: true,
        },
        { kind: 'pause', id: 'readReverse' },
    ],
};

export default {
    id: 'side-panel',
    titleKey: 'ponder.targets.sidePanel',
    category: 'playback',
    summaryKey: 'ponder.summaries.side_panel',
    hoverSelector: '[data-testid="unified-panel-surface"]',
    relatedTargetIds: [
        'panel-cover-actions',
        'panel-cover-tab',
        'panel-source-tab',
        'panel-controls-tab',
        'panel-queue-tab',
        'panel-account-tab',
        'panel-slide',
    ],
    scenes: [structure, cycleTabs],
} satisfies PonderTargetDefinition;
