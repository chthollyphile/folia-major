import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { ListFilter, X } from 'lucide-react';
import type { ProviderSongListCategoryGroup } from '../../../../types/onlineMusic';
import type { CategorySelection } from '../../../core/model/categorySelectionState';

// 分类选择的形状属于分类状态机（core/model/categorySelectionState），面板只是消费它；
// 这里转出一次，原来的 import 点不必改。
export type { CategorySelection };
import { gridChromeClassesFor } from '../home/GridViewTabs';
import { useReducedMotionFor } from '../../../../hooks/useReducedMotionFor';

// src/library/suites/grid/shared/CategoryFilterPanel.tsx
//
// 歌单广场的分类筛选。两级：组（语种/流派/主题/心情/场景）→ 组内细分项。
//
// 形状的取舍：不用方角矩形。整块用大圆角收边，上方贴胶囊、下方自由，中间靠一条逐渐
// 隐去的发丝线分层。这样它读起来是「从胶囊里长出来的一页」，而不是又一块方卡片压在网格上。
//
// 宽度受控：宽度按视口夹紧（vw + max-w 双保险），细分项超过一行就换行而不是把面板撑宽，
// 所以再窄的窗口也不会切掉内容。


interface CategoryFilterPanelProps {
    groups: ProviderSongListCategoryGroup[];
    isDaylight: boolean;
    selected: CategorySelection | null;
    onSelect: (selection: CategorySelection | null) => void;
    onClose: () => void;
    /**
     * 宽度档（0.42 / 0.55 / 1）。窗口越宽面板越宽，让一屏放得下更多胶囊、少换一行；
     * 分段而不是线性，避免拖动窗口时宽度持续抖动。
     */
    sizeScale?: number;
}

export const CategoryFilterPanel: React.FC<CategoryFilterPanelProps> = ({
    groups,
    isDaylight,
    selected,
    onSelect,
    onClose,
    sizeScale = 0.55,
}) => {
    const { t } = useTranslation();
    const chrome = gridChromeClassesFor(isDaylight);
    const calm = useReducedMotionFor('uiMicroMotion');
    const [activeGroupId, setActiveGroupId] = useState<string | null>(
        () => groups.find(group => group.items.some(item => item.id === selected?.itemId))?.id ?? groups[0]?.id ?? null,
    );
    const panelRef = useRef<HTMLDivElement>(null);

    // 面板开着时点外面收起。只在挂载期间生效，关闭即移除，不给全局留监听。
    useEffect(() => {
        if (!panelRef.current) return undefined;
        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (target && !panelRef.current?.contains(target)) onClose();
        };
        // 延迟一帧再挂：打开时那一下点击不该立刻把它关掉。
        const frame = requestAnimationFrame(() => window.addEventListener('mousedown', handlePointerDown));
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener('mousedown', handlePointerDown);
        };
    }, [onClose]);

    // Esc 收起同样只在这个面板开着时有效（父级 Esc 走自己的返回链路，这里不抢）。
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.repeat) return;
            event.stopPropagation();
            onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const activeGroup = useMemo(
        () => groups.find(group => group.id === activeGroupId) ?? null,
        [activeGroupId, groups],
    );

    if (groups.length === 0) return null;

    // 玻璃底色：不是纯黑或纯白的一片，而是带主题倾向的半透明，靠 backdrop-blur 把后面的
    // 卡片虚化出来——和首页胶囊同一套质感，只是这里层数更多一点。
    const glass = isDaylight
        ? 'bg-white/70 border-black/10 shadow-[0_18px_50px_-24px_rgba(0,0,0,0.45)]'
        : 'bg-black/45 border-white/10 shadow-[0_18px_50px_-24px_rgba(0,0,0,0.75)]';

    const captionClass = `${chrome.strongText} flex items-center gap-1.5 text-xs font-medium`;

    return (
        <motion.div
            ref={panelRef}
            // 进出同源：spring 让展开有「弹一下」的生命感，收起也不生硬。
            // 幅度刻意小（y -6 / scale .98），面板是工具不是主角，不该抢卡片的注意力。
            initial={calm ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
            animate={calm ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={calm ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
            transition={calm ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 34, mass: 0.7 }}
            data-ponder-panel-category
            role="dialog"
            aria-label={t('home.categoryTitle')}
            className={`pointer-events-auto absolute right-0 top-full z-20 mt-2 max-h-[min(70vh,32rem)] overflow-y-auto rounded-[1.75rem] border p-2.5 backdrop-blur-2xl scrollbar-thin ${glass}`} style={{ width: `min(${Math.round(sizeScale * 100)}vw, ${Math.round(sizeScale * 30)}rem)` }}
        >
            {/* 上行：标题 + 清除/关闭 */}
            <div className="mb-2 flex items-center justify-between gap-2 px-1.5">
                <span className={captionClass}>
                    <ListFilter size={13} className="opacity-60" />
                    {t('home.categoryTitle')}
                </span>
                <div className="flex items-center gap-1">
                    {selected && (
                        <button
                            type="button"
                            onClick={() => onSelect(null)}
                            className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${chrome.softText}`}
                        >
                            {t('home.categoryClear')}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={t('ui.close')}
                        className={`rounded-full p-1 transition-colors ${chrome.softText}`}
                    >
                        <X size={13} />
                    </button>
                </div>
            </div>

            {/* 第一行：分组胶囊 */}
            <div className="mb-2 flex flex-wrap items-center gap-1.5 px-0.5">
                <button
                    type="button"
                    onClick={() => onSelect(null)}
                    className={`flex h-6 items-center rounded-full px-2.5 text-[11px] font-medium transition-colors ${
                        !selected ? `${chrome.activePill} ${chrome.strongText}` : `${chrome.pill} ${chrome.softText}`
                    }`}
                >
                    {t('home.categoryAll')}
                </button>
                {groups.map(group => {
                    const isActive = activeGroupId === group.id;
                    const hasSelection = group.items.some(item => item.id === selected?.itemId);
                    return (
                        <button
                            key={group.id}
                            type="button"
                            onClick={() => setActiveGroupId(group.id)}
                            className={`flex h-6 items-center rounded-full px-2.5 text-[11px] font-medium transition-colors ${
                                isActive ? `${chrome.activePill} ${chrome.strongText}` : `${chrome.pill} ${chrome.softText}`
                            }`}
                        >
                            {group.label}
                            {hasSelection && <span className="ml-1 opacity-70">·</span>}
                        </button>
                    );
                })}
            </div>

            {/* 第二行：当前组的细分项。分层用渐隐发丝线，不用一条死板的实线。 */}
            <div className={`relative border-t pt-2 ${isDaylight ? 'border-black/5' : 'border-white/5'}`}>
                <div
                    aria-hidden="true"
                    className={`pointer-events-none absolute inset-x-0 -top-px h-px ${
                        isDaylight
                            ? 'bg-gradient-to-r from-transparent via-black/15 to-transparent'
                            : 'bg-gradient-to-r from-transparent via-white/20 to-transparent'
                    }`}
                />
                <div className="flex flex-wrap items-center gap-1.5 px-0.5">
                    {(activeGroup?.items ?? []).map(item => {
                        const isActive = selected?.itemId === item.id;
                        return (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => onSelect(
                                    isActive
                                        ? null
                                        : { groupLabel: activeGroup?.label ?? '', itemId: item.id, itemLabel: item.label },
                                )}
                                className={`flex h-6 items-center rounded-full px-2.5 text-[11px] font-medium transition-colors ${
                                    isActive ? `${chrome.activePill} ${chrome.strongText}` : `${chrome.pill} ${chrome.softText}`
                                }`}
                            >
                                {item.label}
                            </button>
                        );
                    })}
                </div>
            </div>
        </motion.div>
    );
};

interface CategoryFilterButtonProps {
    isDaylight: boolean;
    open: boolean;
    selectedLabel: string | null;
    onClick: () => void;
}

/** actions 行里那个入口胶囊。图标 + 「分类」（选中后显示选中的那一项）。 */
export const CategoryFilterButton: React.FC<CategoryFilterButtonProps> = ({
    isDaylight,
    open,
    selectedLabel,
    onClick,
}) => {
    const { t } = useTranslation();
    const chrome = gridChromeClassesFor(isDaylight);
    return (
        <button
            type="button"
            onClick={onClick}
            title={t('home.categoryTitle')}
            className={`flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium backdrop-blur-md transition-colors ${
                open || selectedLabel
                    ? `${chrome.activePill} ${chrome.strongText}`
                    : `${chrome.pill} ${chrome.softText}`
            }`}
        >
            <ListFilter size={13} />
            <span className="whitespace-nowrap">{selectedLabel ?? t('home.categoryTitle')}</span>
        </button>
    );
};
