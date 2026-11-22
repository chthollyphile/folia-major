import React from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { PanelsTopLeft } from 'lucide-react';
import type { LibraryHomeGroupView } from '../../../core/home/homeModel.contract';
import type { LibraryHomeExtraTab } from '../../../core/suite/suite.contract';

// src/library/suites/grid/home/Grid3DHomeTabs.tsx
// 网格首页顶部的胶囊：首页两级页签的一级那一排——Folia、当前在线音源（名字跟着当前音源，只是一个页签；换音源在账户 / 登录窗口里做）、本地、
// Navidrome，后面接模组的首页页面、舞台与队列拼贴这几个「去哪儿」。二级页签在它正下方的小胶囊里（GridViewTabs：
// 在线组的歌单 / 推荐 / 探索 / 专辑，本地与 Navidrome 的 section）。数据都是 Grid3D 给的，这里只画。

const HIGHLIGHT_LAYOUT_ID = 'home-active-tab-pill-desktop';

type Grid3DHomeTabsProps = {
    groups: readonly LibraryHomeGroupView[];
    onSelectGroup: (group: LibraryHomeGroupView) => void;
    extraTabs?: readonly LibraryHomeExtraTab[];
    isDaylight: boolean;
    stage: { enabled: boolean; active: boolean; open?: () => void };
    /** 队列拼贴（或探索页上的探索拼贴）的入口；不该出现时为 null。 */
    lattice: { explore: boolean; open: () => void } | null;
};

export const Grid3DHomeTabs: React.FC<Grid3DHomeTabsProps> = ({
    groups,
    onSelectGroup,
    extraTabs,
    isDaylight,
    stage,
    lattice,
}) => {
    const { t } = useTranslation();
    const navPillBg = isDaylight ? 'bg-black/5' : 'bg-white/10';
    const inactiveText = isDaylight ? 'text-black/60 hover:text-black' : 'text-white/60 hover:text-white';
    const activeText = isDaylight ? 'text-black font-bold' : 'text-black';

    return (
        <div className={`relative ${navPillBg} backdrop-blur-md p-1 rounded-3xl scale-90 md:scale-100 origin-center max-w-full`}>
            {/* 窄窗口里放不下一行时折成两行（圆角是 3xl：一行时仍是胶囊形）。 */}
            <div className="inline-flex max-w-full flex-wrap items-center justify-center gap-0" role="navigation">
                {groups.map((group) => {
                    return (
                        <span key={group.key} title={group.disabledReason || group.label} className="inline-flex">
                            <button
                                type="button"
                                data-home-group={group.key}
                                disabled={group.target === null}
                                aria-label={group.disabledReason || group.label}
                                aria-current={group.active ? 'page' : undefined}
                                onClick={() => onSelectGroup(group)}
                                className={`relative inline-flex items-center justify-center px-4 py-1.5 rounded-full text-xs md:text-sm font-medium transition-colors duration-300 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-35 ${group.active ? activeText : inactiveText}`}
                            >
                                {group.active && (
                                    <motion.span
                                        layoutId={HIGHLIGHT_LAYOUT_ID}
                                        className="absolute inset-0 rounded-full bg-white shadow-sm"
                                        transition={{ type: 'spring', stiffness: 460, damping: 36, mass: 0.9 }}
                                    />
                                )}
                                {/* 在线组的名字是音源的名字，长短不定：太长的截断，全名在 title。 */}
                                <span className="relative z-10 block max-w-[9rem] truncate">{group.label}</span>
                            </button>
                        </span>
                    );
                })}
                {extraTabs?.map(tab => (
                    <button key={tab.id} type="button" onClick={tab.select}
                        className={`relative inline-flex items-center justify-center px-4 py-1.5 rounded-full text-xs md:text-sm font-medium whitespace-nowrap ${inactiveText}`}>
                        {tab.label}
                    </button>
                ))}
                {stage.enabled && (
                    <button
                        onClick={() => stage.open?.()}
                        data-stage-active={stage.active ? 'true' : 'false'}
                        className={`relative inline-flex items-center justify-center px-4 py-1.5 rounded-full text-xs md:text-sm font-medium transition-colors duration-300 whitespace-nowrap ${inactiveText}`}
                    >
                        <span className="relative z-10">{t('home.stage')}</span>
                    </button>
                )}
                {/* 播放队列的海报视图和 Stage 一样属于「去哪儿」，所以它在这一排，
                    而不是标题旁的工具图标。没有在播歌曲时队列也是空的，直接不出现。
                    平时只占一个图标的宽度，指针悬停或键盘聚焦时才展开文字——这一排
                    已经有几个内容 tab，多一个常驻文字就把胶囊撑得太长。点击始终直达。
                    在「探索」页签上它打开的是同一面墙，铺的是探索页的条目（探索拼贴）：
                    探索页有条目可铺时出现，不看有没有在播歌曲。 */}
                {lattice && (
                    <button
                        onClick={lattice.open}
                        data-testid="home-lattice-pill"
                        title={t(lattice.explore ? 'home.latticeExplore' : 'home.lattice')}
                        aria-label={t(lattice.explore ? 'home.latticeExplore' : 'home.lattice')}
                        className={`group relative inline-flex items-center justify-center px-3 py-1.5 rounded-full text-xs md:text-sm font-medium transition-colors duration-300 whitespace-nowrap ${inactiveText}`}
                    >
                        <PanelsTopLeft size={14} className="relative z-10 shrink-0" />
                        <span
                            aria-hidden="true"
                            className="relative z-10 max-w-0 overflow-hidden opacity-0 transition-all duration-300 ease-out group-hover:ml-1.5 group-hover:max-w-28 group-hover:opacity-100 group-focus-visible:ml-1.5 group-focus-visible:max-w-28 group-focus-visible:opacity-100"
                        >
                            {t(lattice.explore ? 'home.latticeExplore' : 'home.latticeLabel')}
                        </span>
                    </button>
                )}
            </div>
        </div>
    );
};

export default Grid3DHomeTabs;
