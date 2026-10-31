import React, { useId } from 'react';
import { motion } from 'framer-motion';
import { useReducedMotionFor } from '../../../../hooks/useReducedMotionFor';
import { pillChromeClassesFor as gridChromeClassesFor } from '../../../../components/shared/pillChrome';
import { useGlass } from '@/shinoinject/useGlass';

// src/library/suites/grid/home/GridViewTabs.tsx
// The second level of the home header's view capsule: centred right under it, a smaller capsule
// holding the map of all cards and, where the grid has them, its collection types (folders /
// albums / artists / playlists). Every type stays on screen so the switch reads as a switch: the
// active one shows its label, the rest shrink to their icon. It used to collapse to the active
// type behind a small chevron, styled like the action buttons, and listeners never found the rest.

// 保留网格现有导出名；平台连接入口从共享配色模块读取，不反向 import suite。
export { pillChromeClassesFor as gridChromeClassesFor } from '../../../../components/shared/pillChrome';

export type GridViewTab = {
    id: string;
    label: React.ReactNode;
    /** Without an icon an option keeps its label even when inactive, or it would be blank. */
    icon?: React.ReactNode;
    active?: boolean;
    disabled?: boolean;
    onClick: () => void;
};

type GridViewTabsProps = {
    tabs: GridViewTab[];
    isDaylight: boolean;
    /** The map-of-all-cards entry, first in the capsule and set off from the types by a rule. */
    onOpenMap?: () => void;
    mapLabel?: string;
    mapIcon?: React.ReactNode;
    /** Marks the capsule for the Ponder hover lookup. */
    ponderId?: string;
};

const SPRING = { type: 'spring', stiffness: 460, damping: 36, mass: 0.9 } as const;

export const GridViewTabs: React.FC<GridViewTabsProps> = ({ tabs, isDaylight, onOpenMap, mapLabel, mapIcon, ponderId }) => {
    // Scoped per instance so two grids never share one sliding highlight.
    const highlightId = useId();
    const calm = useReducedMotionFor('uiMicroMotion');
    const transition = calm ? { duration: 0 } : SPRING;
    const chrome = gridChromeClassesFor(isDaylight);
    useGlass();
    return (
        <div data-glass  className={`pointer-events-auto flex h-7 items-center rounded-full p-0.5 ${isDaylight ? "border-y border-black/[0.08] bg-[#fff4]" : "border-y border-white/[0.12] bg-[#0004]"} outline outline-1 outline-[rgba(40,40,40,0.2)] shadow-[2px_2px_8px_2px_rgba(40,40,40,0.4)]`}>
            {onOpenMap && (
                <button
                    type="button"
                    onClick={(event) => {
                        event.currentTarget.blur();
                        onOpenMap();
                    }}
                    className={`flex h-6 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${chrome.softText}`}
                >
                    {mapIcon}
                    <span className="whitespace-nowrap">{mapLabel}</span>
                </button>
            )}
            {onOpenMap && tabs.length > 0 && <span aria-hidden="true" className={`mx-1 h-3.5 w-px ${chrome.divider}`} />}
            {tabs.length > 0 && (
                <div role="tablist" data-ponder={ponderId} className="flex items-center">
                    {tabs.map(tab => {
                        const label = typeof tab.label === 'string' ? tab.label : undefined;
                        const showLabel = tab.active || !tab.icon;
                        return (
                            <motion.button
                                key={tab.id}
                                layout
                                transition={transition}
                                type="button"
                                role="tab"
                                aria-selected={Boolean(tab.active)}
                                aria-label={label}
                                // The icon-only options need their name somewhere a pointer can reach.
                                title={showLabel ? undefined : label}
                                disabled={tab.disabled}
                                onClick={() => {
                                    if (!tab.active) tab.onClick();
                                }}
                                className={`relative flex h-6 items-center gap-1.5 rounded-full text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                                    showLabel ? 'px-3' : 'w-7 justify-center'
                                } ${tab.active ? chrome.strongText : chrome.softText}`}
                            >
                                {tab.active && (
                                    <motion.span
                                        layoutId={highlightId}
                                        transition={transition}
                                        className={`absolute inset-0 rounded-full ${chrome.activePill}`}
                                    />
                                )}
                                {tab.icon && <span className="relative flex shrink-0 items-center">{tab.icon}</span>}
                                {showLabel && (
                                    <motion.span
                                        initial={calm || !tab.active ? false : { opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ duration: calm ? 0 : 0.18, delay: calm ? 0 : 0.06 }}
                                        className="relative whitespace-nowrap"
                                    >
                                        {tab.label}
                                    </motion.span>
                                )}
                            </motion.button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default GridViewTabs;
