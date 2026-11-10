import { sidePanelTabRelatedIds, sidePanelTabScene } from './sidePanelShared';
import type { PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/panel/panelCoverTab.target.ts
// 控制面板里的「封面」标签页。
//
// 一页一个目标：指针停在哪一格上，讲的就是那一页。四页各是一整套设置，
// 合成一章只会变成罗列名词，而读者手上正好停在其中一页。

export default {
    id: 'panel-cover-tab',
    titleKey: 'ponder.targets.panelCoverTab',
    category: 'playback',
    summaryKey: 'ponder.summaries.panel_cover_tab',
    hoverSelector: '[data-ponder-panel-tab-button="cover"]',
    priority: 1,
    relatedTargetIds: sidePanelTabRelatedIds('panel-cover-tab'),
    scenes: [
        sidePanelTabScene('panel-cover-tab', 'ponder.scenes.sidePanelCoverTab', 'cover-tab', 'cover', ['ponder.captions.sidePanel.coverTab', 'ponder.captions.sidePanel.coverTabDetail'], 'credits'),
    ],
} satisfies PonderTargetDefinition;
