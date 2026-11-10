import React from 'react';
import { useRowAria } from './Row';

// src/components/modal/settings/kit/Progress.tsx
// How far something has come: a download, an export. A thin bar the length of a slider's track,
// with the progress in words beside it when the page gives them.

type ProgressProps = {
    /** From 0 to 1. */
    value: number;
    /** How the progress reads beside the bar, e.g. "42%" or "12 / 30 MB". */
    children?: React.ReactNode;
};

export const Progress: React.FC<ProgressProps> = ({ value, children }) => {
    const done = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

    return (
        <span className="flex min-w-0 items-center gap-3">
            <span
                role="progressbar"
                {...useRowAria()}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(done * 100)}
                className="relative block h-1 w-[200px] min-w-0 max-w-full overflow-hidden rounded-full bg-[var(--st-track)]"
            >
                {/* The whole bar, pushed out to the left by what is still to come. */}
                <span
                    className="st-t-move absolute inset-0 rounded-full bg-[var(--st-accent)] transition-transform"
                    style={{ transform: `translateX(${(done - 1) * 100}%)` }}
                />
            </span>
            {children !== undefined && (
                <span className="shrink-0 text-right text-[13px] tabular-nums text-[color:var(--st-t1)]">{children}</span>
            )}
        </span>
    );
};

export default Progress;
