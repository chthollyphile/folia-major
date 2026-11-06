import React from 'react';
import { FoldHorizontal } from 'lucide-react';
import type { ScratchpadTab } from '../../../stores/useScratchpadStore';
import ScratchpadShape from './ScratchpadShape';
import { SCRATCHPAD_TAB_SHAPES } from './scratchpadLook';

// src/components/app/scratchpad/ScratchpadRail.tsx
// 左缘面板最左边那一列（最深的黑）：顶上收起速记簿，下面三个竖排页签。「展开整页」在信息条的右端（ScratchpadPanel）。
// 页签前面是各页的几何体（速记簿圆、历史三角、队列「》」），带条数；选中的那个垫一块斜着的米白纸，几何体换成点缀色。
// 页签的键盘操作（上下 / 左右方向键、Home / End）由宿主给；抽屉里 Tab 键整个用来换页（ScratchpadHost）。

export type ScratchpadRailTab = {
    id: ScratchpadTab;
    label: string;
    count: number;
};

type ScratchpadRailProps = {
    tab: ScratchpadTab;
    tabs: ScratchpadRailTab[];
    ariaLabel: string;
    onSelect: (tab: ScratchpadTab) => void;
    onTabsKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
    closeLabel: string;
    onClose: () => void;
};

const ScratchpadRail: React.FC<ScratchpadRailProps> = ({
    tab, tabs, ariaLabel, onSelect, onTabsKeyDown, closeLabel, onClose,
}) => (
    <nav className="scratchpad-rail">
        <button type="button" className="scratchpad-icon-button" title={closeLabel} aria-label={closeLabel} onClick={onClose}>
            <FoldHorizontal aria-hidden="true" />
        </button>
        <div className="scratchpad-rail-tabs" role="tablist" aria-label={ariaLabel} aria-orientation="vertical" onKeyDown={onTabsKeyDown}>
            {tabs.map(({ id, label, count }) => {
                const selected = id === tab;
                return (
                    <button
                        key={id}
                        type="button"
                        role="tab"
                        id={`scratchpad-tab-${id}`}
                        className="scratchpad-tab"
                        data-scratchpad-tab={id}
                        aria-selected={selected}
                        aria-controls="scratchpad-panel"
                        tabIndex={selected ? 0 : -1}
                        onClick={() => onSelect(id)}
                    >
                        <span className="scratchpad-tab-face" aria-hidden="true" />
                        <ScratchpadShape kind={SCRATCHPAD_TAB_SHAPES[id]} size={12} fill={selected ? 'var(--scratchpad-mark)' : 'currentColor'} />
                        <span className="scratchpad-tab-label">{label}</span>
                        <span className="scratchpad-tab-number">{count}</span>
                    </button>
                );
            })}
        </div>
    </nav>
);

export default ScratchpadRail;
