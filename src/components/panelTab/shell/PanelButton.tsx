import React from 'react';
import type { LucideIcon } from 'lucide-react';

// src/components/panelTab/shell/PanelButton.tsx
// A button of the panel that says what it does: an icon and a name on a filled ground, as the
// settings kit's button looks. It can take a share of its row's width, so that two of them fill a
// line, and it carries the attributes a caller gives it (for the lessons, for a dialog it opens).

type PanelButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'className'> & {
    icon?: LucideIcon;
    /** Shares the width of its row with its neighbours, instead of being as wide as its name. */
    grow?: boolean;
    /** The name. */
    children: React.ReactNode;
};

export const PanelButton: React.FC<PanelButtonProps> = ({ icon: Icon, grow, children, ...button }) => (
    <button
        type="button"
        {...button}
        className={`st-t-fast inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-[var(--st-fill)] px-3 text-[13px] text-[color:var(--st-t1)] transition-[background-color,opacity,scale] enabled:hover:bg-[var(--st-fill2)] enabled:active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40 ${grow ? 'flex-[1_1_auto]' : 'shrink-0'}`}
    >
        {Icon && <Icon size={14} />}
        {children}
    </button>
);

export default PanelButton;
