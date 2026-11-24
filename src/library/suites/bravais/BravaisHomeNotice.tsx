import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Cable } from 'lucide-react';
import type { BravaisLayer, BravaisSeamModel } from './bravaisLayer';
import type { BravaisHomeEntry, BravaisHomeTool } from './bravaisHomeModels';
import type { BravaisWallHint } from './bravaisSeamModels';
import type { BravaisHomeChrome } from './useBravaisHomeChrome';
import { useBravaisLayerRegistration } from './useBravaisLayerRegistration';

// src/library/suites/bravais/BravaisHomeNotice.tsx
// 首页里没有卡片可铺、只说一件事的墙：在线组一个音源都没启用（BravaisHomeNoSources）——墙面上说去「设置 → 音源」
// 启用，缝里给那个入口（只桌面版有）。它仍是首页层（一级页签、搜索、app 入口照常在缝里），墙上的说明是
// BravaisWallHint 那种背景字。

const NO_ITEMS: BravaisLayer['items'] = [];
const NO_KEYS: ReadonlySet<string> = new Set();
const noop = () => undefined;

const NoticeLayer: React.FC<{
    chrome: BravaisHomeChrome;
    isInteractive: boolean;
    layerKey: string;
    meta: string;
    hint: BravaisWallHint;
    entries?: BravaisHomeEntry[];
    /** 在线组的二级切换要不要留在缝里（没有音源时不留）。 */
    onlineSections?: boolean;
}> = ({ chrome, isInteractive, layerKey, meta, hint, entries, onlineSections = false }) => {
    const { t } = useTranslation();
    const tools = useMemo<BravaisHomeTool[]>(() => [chrome.searchTool, ...chrome.appTools], [chrome.appTools, chrome.searchTool]);
    const seam = useMemo<BravaisSeamModel>(() => ({
        title: chrome.title,
        crumb: chrome.title,
        meta,
        tabs: chrome.tabs,
        onSelectTab: chrome.onSelectTab,
        home: {
            sections: onlineSections ? chrome.onlineSections : undefined,
            onSelectSection: onlineSections ? chrome.onSelectOnlineSection : undefined,
            entries,
            shortcutsLabel: t('libraryBravaisHome.shortcuts'),
            tools,
            menuLabel: t('libraryBravaisHome.more'),
            pageToolsLabel: t('libraryBravaisHome.pageTools'),
            scan: chrome.scan,
            search: chrome.search,
        },
    }), [
        chrome.onSelectOnlineSection, chrome.onSelectTab, chrome.onlineSections, chrome.scan, chrome.search, chrome.tabs,
        chrome.title, entries, meta, onlineSections, t, tools,
    ]);
    const wall = useMemo(() => ({ filterKey: layerKey, hint }), [hint, layerKey]);
    const home = useMemo(() => ({ cycleTab: chrome.cycleTab }), [chrome.cycleTab]);
    const layer = useMemo<BravaisLayer>(() => ({
        key: layerKey,
        sessionKey: 'home',
        surface: 'home',
        mode: 'infinite',
        items: NO_ITEMS,
        seam,
        isInteractive,
        focusedEntryKey: null,
        nowPlayingKey: null,
        queuedKeys: NO_KEYS,
        onOpenItem: noop,
        wall,
        home,
    }), [home, isInteractive, layerKey, seam, wall]);
    useBravaisLayerRegistration('home', layer);
    return null;
};

export const BravaisHomeNoSources: React.FC<{
    chrome: BravaisHomeChrome;
    isInteractive: boolean;
    /** 首页层的身份（`home:<在线页>`）。 */
    layerKey: string;
    meta: string;
}> = ({ chrome, isInteractive, layerKey, meta }) => {
    const { t } = useTranslation();
    const hint = useMemo<BravaisWallHint>(() => ({ title: t('home.noSourcesTitle'), body: t('home.noSourcesBody') }), [t]);
    const { openSourceSettings } = chrome;
    const entries = useMemo<BravaisHomeEntry[] | undefined>(() => (openSourceSettings
        ? [{ id: 'open-source-settings', label: t('home.noSourcesAction'), icon: Cable, run: openSourceSettings }]
        : undefined), [openSourceSettings, t]);
    return <NoticeLayer chrome={chrome} isInteractive={isInteractive} layerKey={layerKey} meta={meta} hint={hint} entries={entries} />;
};
