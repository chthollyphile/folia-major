import { SIDE_PANEL_CONTROLS_ANCHORS, sidePanelTabRelatedIds, sidePanelTabScene } from './sidePanelShared';
import type { PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/panel/panelControlsTab.target.ts
// 控制面板里的「控制」标签页。
//
// 一页一个目标：指针停在哪一格上，讲的就是那一页。四页各是一整套设置，
// 合成一章只会变成罗列名词，而读者手上正好停在其中一页。
//
// 第二章单独讲歌词样式、背景类型那两行：两端的箭头只换到相邻的一个，而点**中间那颗按钮**
// 才弹出全部样式的一格图。十来个样式只靠箭头，得一次一步地翻。

/** 第二章：两端的箭头只走一格，中间那颗按钮点开才是全部。 */
const modeList: PonderSceneScript = {
    id: 'panel-controls-tab-mode-list',
    titleKey: 'ponder.scenes.sidePanelControlsModeList',
    anchors: SIDE_PANEL_CONTROLS_ANCHORS,
    steps: [
        { kind: 'surfaceState', id: 'openTab', anchor: 'panel', state: 'controls-tab', durationMs: 460, keyframe: true },
        { kind: 'highlight', id: 'markRow', anchor: 'modeRow', intensity: [0, 0.85], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'steppers',
            textKey: 'ponder.captions.sidePanel.controlsSteppers',
            pointTo: { anchor: 'modeRow' }, durationMs: 6400, withPrevious: true,
        },
        { kind: 'pause', id: 'readSteppers' },

        { kind: 'highlight', id: 'dimRow', anchor: 'modeRow', intensity: [0.85, 0], durationMs: 360, keyframe: true },
        { kind: 'cursor', id: 'clickName', to: { anchor: 'modeName' }, press: 'tap', durationMs: 660, withPrevious: true },
        { kind: 'surfaceState', id: 'listOpens', anchor: 'panel', state: 'controls-mode-list', durationMs: 480 },
        {
            kind: 'caption', id: 'list',
            textKey: 'ponder.captions.sidePanel.controlsModeList',
            pointTo: { anchor: 'modeList' }, durationMs: 7000, withPrevious: true,
        },
        { kind: 'pause', id: 'readList' },

        { kind: 'highlight', id: 'markFooter', anchor: 'modeListFooter', intensity: [0, 0.95], durationMs: 440, keyframe: true },
        {
            kind: 'caption', id: 'footer',
            textKey: 'ponder.captions.sidePanel.controlsModeListFooter',
            pointTo: { anchor: 'modeListFooter' }, durationMs: 6000, withPrevious: true,
        },
        { kind: 'pause', id: 'readFooter' },
    ],
};

export default {
    id: 'panel-controls-tab',
    titleKey: 'ponder.targets.panelControlsTab',
    category: 'playback',
    summaryKey: 'ponder.summaries.panel_controls_tab',
    hoverSelector: '[data-ponder-panel-tab-button="controls"]',
    priority: 1,
    relatedTargetIds: sidePanelTabRelatedIds('panel-controls-tab'),
    scenes: [
        sidePanelTabScene('panel-controls-tab', 'ponder.scenes.sidePanelControlsTab', 'controls-tab', 'controls', ['ponder.captions.sidePanel.controlsTab', 'ponder.captions.sidePanel.controlsTabDetail']),
        modeList,
    ],
} satisfies PonderTargetDefinition;
