import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ScratchpadTab } from '../../../stores/useScratchpadStore';
import ScratchpadRail, { type ScratchpadRailTab } from './ScratchpadRail';
import ScratchpadBand from './ScratchpadBand';
import ScratchpadGreeting from './ScratchpadGreeting';
import { useScratchpadHistory } from './useScratchpadHistory';
import { SCRATCHPAD_TABS } from './scratchpadLook';

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
                expandLabel={expandLabel}
                expandDisabled={expandDisabled}
                onExpand={onExpand}
                expandRef={expandRef}
            />
            <div className="scratchpad-sheet">
                <ScratchpadBand
                    tab={tab}
                    index={String(SCRATCHPAD_TABS.indexOf(tab) + 1).padStart(2, '0')}
                    title={t(TAB_TITLE_KEYS[tab])}
                    count={current.count}
                />
                {/* 按时段的问候放大，下面一道短杠；这一页的说明在 children 的最上面（随页换）。 */}
                <div className="scratchpad-intro">
                    <ScratchpadGreeting long headline />
                    <span className="scratchpad-intro-rule" aria-hidden="true" />
                </div>
                {children}
            </div>
        </>
    );
};

export default ScratchpadPanel;
