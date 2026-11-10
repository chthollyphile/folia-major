import { sidePanelTabRelatedIds, sidePanelTabScene } from './sidePanelShared';
import type { PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/panel/panelAccountTab.target.ts
// 控制面板里的「账号」标签页。
//
// 一页一个目标：指针停在哪一格上，讲的就是那一页。四页各是一整套设置，
// 合成一章只会变成罗列名词，而读者手上正好停在其中一页。

export default {
    id: 'panel-account-tab',
    titleKey: 'ponder.targets.panelAccountTab',
    category: 'playback',
    summaryKey: 'ponder.summaries.panel_account_tab',
    hoverSelector: '[data-ponder-panel-tab-button="account"]',
    priority: 1,
    relatedTargetIds: [...sidePanelTabRelatedIds('panel-account-tab'), 'sign-in'],
    scenes: [
        sidePanelTabScene('panel-account-tab', 'ponder.scenes.sidePanelAccountTab', 'account-tab', 'account', ['ponder.captions.sidePanel.accountTab', 'ponder.captions.sidePanel.accountTabDetail']),
    ],
} satisfies PonderTargetDefinition;
