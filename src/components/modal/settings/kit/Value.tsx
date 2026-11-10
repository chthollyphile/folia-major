import React from 'react';
import { Tooltip } from './Tooltip';

// src/components/modal/settings/kit/Value.tsx
// Read-only text in a row's control slot: a current value, a file name, a state.

type ValueProps = {
    /** The full text, shown in the kit's tooltip, for a value that may be cut short. */
    tip?: string;
    children: React.ReactNode;
};

export const Value: React.FC<ValueProps> = ({ tip, children }) => (
    <Tooltip text={tip} className="max-w-[260px] truncate text-[13px] tabular-nums text-[color:var(--st-t2)]">
        {children}
    </Tooltip>
);

export default Value;
