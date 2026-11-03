import React from 'react';

// src/components/panelTab/shell/EmptyState.tsx
// What a panel tab shows when it has nothing to list: an icon and one line that says why, in the
// middle of a space that keeps the tab from folding to nothing.

type EmptyStateProps = {
    /** Drawn at 28 px in the mock-up. */
    icon: React.ReactNode;
    /** The one line. */
    children: React.ReactNode;
};

export const EmptyState: React.FC<EmptyStateProps> = ({ icon, children }) => (
    <div className="grid min-h-[180px] place-items-center content-center gap-2.5 px-2 py-4 text-[color:var(--st-t3)]">
        {icon}
        <p className="max-w-[264px] text-center text-[13px] leading-5 text-[color:var(--st-t2)]">{children}</p>
    </div>
);

export default EmptyState;
