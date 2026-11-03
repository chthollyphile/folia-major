import React, { useId } from 'react';

// src/components/panelTab/shell/PanelRow.tsx
// A row of a panel tab: a name at the left and its control at the right, 44 px high. One short line
// may sit under the name. A control that does not fit beside the name drops under it by itself. The
// settings kit's Row is made for a window (56 px high, 16 px at the sides, a hairline above); this
// is the panel's.

type PanelRowProps = {
    /** The name. It also names the row's controls for a screen reader. */
    label: React.ReactNode;
    /** One short line under the name: a state or a measured value. */
    hint?: React.ReactNode;
    /** The control, or controls, at the right end. */
    children?: React.ReactNode;
};

export const PanelRow: React.FC<PanelRowProps> = ({ label, hint, children }) => {
    const labelId = useId();

    return (
        <div role="group" aria-labelledby={labelId} className="flex min-h-11 flex-wrap items-center gap-x-3 px-1 py-1.5">
            <div className="min-w-0 flex-[1_1_72px]">
                <div id={labelId} className="text-sm leading-5">{label}</div>
                {hint && <div className="text-xs leading-4 text-[color:var(--st-t3)]">{hint}</div>}
            </div>
            {children && <div className="ml-auto flex min-w-0 max-w-full items-center gap-1.5">{children}</div>}
        </div>
    );
};

export default PanelRow;
