import React from 'react';
import { Compass, Disc3, ListMusic, Radio } from 'lucide-react';
import type { LibraryHomeGroupView, LibraryHomeOnlineTab, LibraryHomeTabKey } from '../../../core/home/homeModel.contract';
import type { DesktopGrid3DAction } from './DesktopGrid3DSurface';
import { GridViewTabs } from './GridViewTabs';

// src/library/suites/grid/home/OnlineGridTabs.tsx
// 在线组的二级页签（歌单 / 推荐 / 探索 / 专辑）在网格首页里的样子：和本地、Navidrome 的 section 一样，是顶部胶囊
// 正下方那只小胶囊里的选项（GridViewTabs）。有卡片列表的页把它们交给 DesktopGrid3DSurface（和「全部」地图入口排在
// 一只胶囊里）；没有卡片列表的页（探索、未登录、无账户、没有音源）用 OnlineGridTabsRow 在同一个位置单独画一只。
// 组里只有一页时不画（没有可切的）。

const ONLINE_TAB_ICONS: Record<LibraryHomeOnlineTab, React.ReactNode> = {
    playlist: <ListMusic size={13} />,
    radio: <Radio size={13} />,
    explore: <Compass size={13} />,
    albums: <Disc3 size={13} />,
};

/** 在线组的页 → 小胶囊里的选项；不可用的页禁用，原因在 title。 */
export const buildOnlineGridTabs = (
    group: LibraryHomeGroupView | undefined,
    active: LibraryHomeTabKey,
    onSelect: (tab: LibraryHomeTabKey) => void,
): DesktopGrid3DAction[] => {
    if (!group || group.tabs.length < 2) return [];
    return group.tabs.map(tab => ({
        id: tab.key,
        label: tab.label,
        icon: ONLINE_TAB_ICONS[tab.key as LibraryHomeOnlineTab],
        active: tab.key === active,
        disabled: Boolean(tab.disabledReason),
        title: tab.disabledReason,
        onClick: () => onSelect(tab.key),
    }));
};

/** 没有卡片列表的在线页上的二级页签：位置与 DesktopGrid3DSurface 的那一行相同（顶部胶囊正下方、同一条中线）。 */
export const OnlineGridTabsRow: React.FC<{ tabs: DesktopGrid3DAction[]; isDaylight: boolean; label: string }> = ({ tabs, isDaylight, label }) => {
    if (tabs.length === 0) return null;
    return (
        <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center px-4" data-home-online-tabs>
            <GridViewTabs tabs={tabs} isDaylight={isDaylight} label={label} />
        </div>
    );
};
