import React, { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Maximize2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ScratchpadTab } from '../../../stores/useScratchpadStore';
import ScratchpadRail, { type ScratchpadRailTab } from './ScratchpadRail';
import ScratchpadBand from './ScratchpadBand';
import ScratchpadGreeting from './ScratchpadGreeting';
import { useScratchpadHistory } from './useScratchpadHistory';
import { SCRATCHPAD_TABS } from './scratchpadLook';
import { useReducedMotionFor } from '../../../hooks/useReducedMotionFor';

// src/components/app/scratchpad/ScratchpadPanel.tsx
// 左缘的面板（设计稿 A 按 F 定稿适配；盖在墙上，不推开墙）：左边一列页签（ScratchpadRail），右边是内容区——
// 顶上一条米白信息条（ScratchpadBand），下面放大的问候和一道点缀色的短杠，再下面是这一页（宿主交进来的 children：
// 说明、列表、底部按钮）。分区靠深浅不同的黑，不画描边与分割线；底部按钮与内容同一张底。
// 展开整页时不用它，换成 ScratchpadSheet（倾斜的纸）。

/** 页签列里的短名字（竖排），与信息条上的全名。 */
const TAB_LABEL_KEYS: Record<ScratchpadTab, string> = { notes: 'scratchpad.title', history: 'scratchpad.historyTab', queue: 'scratchpad.queue' };
const TAB_TITLE_KEYS: Record<ScratchpadTab, string> = { notes: 'scratchpad.title', history: 'scratchpad.history', queue: 'scratchpad.queue' };

type ScratchpadPanelProps = {
    tab: ScratchpadTab;
    notesCount: number;
    queueCount: number;
    onSelectTab: (tab: ScratchpadTab) => void;
    onTabsKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
    onClose: () => void;
    expandLabel: string;
    expandDisabled: boolean;
    onExpand: () => void;
    expandRef: React.Ref<HTMLButtonElement>;
    children: React.ReactNode;
};

const ScratchpadPanel: React.FC<ScratchpadPanelProps> = ({
    tab, notesCount, queueCount, onSelectTab, onTabsKeyDown, onClose, expandLabel, expandDisabled, onExpand, expandRef, children,
}) => {
    const { t } = useTranslation();
    const calm = useReducedMotionFor('uiMicroMotion');
    // 页签上写播放历史有几首：只在面板开着时读（面板关着不挂这个组件）。
    const historyCount = useScratchpadHistory().length;
    const tabs = useMemo<ScratchpadRailTab[]>(() => {
        const counts: Record<ScratchpadTab, number> = { notes: notesCount, history: historyCount, queue: queueCount };
        return SCRATCHPAD_TABS.map(id => ({ id, label: t(TAB_LABEL_KEYS[id]), count: counts[id] }));
    }, [historyCount, notesCount, queueCount, t]);
    const current = tabs.find(item => item.id === tab) ?? tabs[0];

    return (
        <>
            <ScratchpadRail
                tab={tab}
                tabs={tabs}
                ariaLabel={t('scratchpad.title')}
                onSelect={onSelectTab}
                onTabsKeyDown={onTabsKeyDown}
                closeLabel={t('scratchpad.close')}
                onClose={onClose}
            />
            <div className="scratchpad-sheet">
                {/* 换页时信息条换成那一页的（计数、标题、纹理、几何体）：新的一条从右边滑进来盖上去，旧的那条在底下待到盖住再走，
                    中途不露出底下的面板。降低动态效果时只淡入。 */}
                <div className="scratchpad-panel-band">
                    <AnimatePresence initial={false}>
                        <motion.div
                            key={tab}
                            className="scratchpad-panel-band-face"
                            initial={{ opacity: 0, x: calm ? 0 : 24 }}
                            animate={{ opacity: 1, x: 0, transition: { duration: calm ? 0.12 : 0.26, ease: [0.22, 1, 0.36, 1] } }}
                            // 旧的那条留在底下等新的盖住：退场时只动一点点透明度（动画要有变化才会等它走完）。
                            exit={{ opacity: 0.99, transition: { duration: calm ? 0.12 : 0.26 } }}
                        >
                            <ScratchpadBand
                                tab={tab}
                                index={String(SCRATCHPAD_TABS.indexOf(tab) + 1).padStart(2, '0')}
                                title={t(TAB_TITLE_KEYS[tab])}
                                count={current.count}
                            />
                        </motion.div>
                    </AnimatePresence>
                    {/* 「展开整页」压在信息条右端探出面板的那一截上（用户定，2026-11-06）。不放进上面换页交接的那一面里：
                        换页时新旧两条同时在场，按钮要是跟着条走就有两颗，收回整页时焦点要落回的那一颗会被旧的卸掉时清空。 */}
                    <button
                        ref={expandRef}
                        type="button"
                        className="scratchpad-band-expand"
                        data-scratchpad-action="toggle-canvas"
                        disabled={expandDisabled}
                        title={expandLabel}
                        aria-label={expandLabel}
                        aria-pressed={false}
                        onClick={onExpand}
                    >
                        <Maximize2 aria-hidden="true" />
                    </button>
                </div>
                {/* 按时段的问候放大（短版，用户定 2026-11-06：长版留给展开整页），下面一道短杠；这一页的说明在 children 的最上面（随页换）。 */}
                <div className="scratchpad-intro">
                    <ScratchpadGreeting long={false} headline />
                    <span className="scratchpad-intro-rule" aria-hidden="true" />
                </div>
                {children}
            </div>
        </>
    );
};

export default ScratchpadPanel;
