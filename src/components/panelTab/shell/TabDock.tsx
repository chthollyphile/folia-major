import React, { useRef } from 'react';
import { Segments } from './Segments';
import { useMeasuredSize } from './useMeasuredSize';

// src/components/panelTab/shell/TabDock.tsx
// The panel's row of tabs, at its bottom edge. Every tab shows its name while the names fit the
// row. When they do not (a mod adds a tab, a longer language, a narrow window) the tabs that are
// not open show their icon and the open one shows icon and name. Whether they fit is measured: the
// names are laid out once more, out of sight, and their width is held against the row's.

export type DockTab<T extends string> = {
    id: T;
    label: string;
    icon: React.ComponentType<{ size?: number }>;
};

type TabDockProps<T extends string> = {
    tabs: ReadonlyArray<DockTab<T>>;
    currentTab: T;
    onTabChange: (tab: T) => void;
};

export const TabDock = <T extends string>({ tabs, currentTab, onTabChange }: TabDockProps<T>): React.ReactElement => {
    const rowRef = useRef<HTMLDivElement>(null);
    const namesRef = useRef<HTMLDivElement>(null);
    const row = useMeasuredSize(rowRef);
    const names = useMeasuredSize(namesRef);
    // One pixel of slack for widths the browser rounds.
    const showNames = names.width <= row.width + 1;

    return (
        <div ref={rowRef} className="relative h-full">
            <Segments
                size="l"
                fill
                value={currentTab}
                onChange={onTabChange}
                options={tabs.map(tab => ({
                    value: tab.id,
                    label: tab.label,
                    icon: showNames ? undefined : <tab.icon size={16} />,
                    iconOnly: !showNames && tab.id !== currentTab,
                    // 每一格各自是一个思索目标：停在哪一格，讲的就是那一页。
                    data: { 'data-ponder-panel-tab-button': tab.id },
                }))}
            />
            {/* The names as the row would show them, laid out to be measured. */}
            <div aria-hidden className="pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden">
                <div ref={namesRef} className="inline-flex px-0.5 text-[13px]">
                    {tabs.map(tab => (
                        <span key={tab.id} className="whitespace-nowrap px-2.5">{tab.label}</span>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default TabDock;
