import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { useRowNaming } from './Row';
import { Tooltip } from './Tooltip';

// src/components/modal/settings/kit/Button.tsx
// The button of the settings: filled by default, accent-coloured for the one action a group ends
// on, and a quiet text button for the action beside a group heading. Given an icon and no text it
// is a square icon button, named by its tip.

const BASE_CLASS = 'st-t-fast inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap transition-[background-color,color,opacity,scale] enabled:active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40';

/** With text. */
const TEXT_CLASS = {
    fill: 'h-8 rounded-lg bg-[var(--st-fill)] px-3 text-[13px] text-[color:var(--st-t1)] enabled:hover:bg-[var(--st-fill2)]',
    primary: 'h-8 rounded-lg bg-[var(--st-accent)] px-3 text-[13px] text-[color:var(--st-on-accent)] enabled:hover:opacity-90',
    quiet: 'h-6 rounded-md px-1.5 text-xs text-[color:var(--st-t2)] enabled:hover:bg-[var(--st-fill)] enabled:hover:text-[color:var(--st-t1)]',
} as const;

/** An icon alone. A disabled one keeps only its dimmed icon, not an empty filled square. */
const ICON_CLASS = {
    fill: 'h-8 w-8 rounded-lg bg-[var(--st-fill)] text-[color:var(--st-t2)] enabled:hover:bg-[var(--st-fill2)] enabled:hover:text-[color:var(--st-t1)] disabled:bg-transparent',
    primary: 'h-8 w-8 rounded-lg bg-[var(--st-accent)] text-[color:var(--st-on-accent)] enabled:hover:opacity-90',
    quiet: 'h-6 w-6 rounded-md text-[color:var(--st-t2)] enabled:hover:bg-[var(--st-fill)] enabled:hover:text-[color:var(--st-t1)]',
} as const;

type ButtonProps = {
    onClick: () => void;
    variant?: 'primary' | 'quiet';
    icon?: LucideIcon;
    /** Shown in the kit's tooltip on hover and on keyboard focus; the name of a button that is only an icon. */
    tip?: string;
    disabled?: boolean;
    children?: React.ReactNode;
};

export const Button: React.FC<ButtonProps> = ({ onClick, variant, icon: Icon, tip, disabled, children }) => {
    const { labelId } = useRowNaming();

    return (
        <Tooltip text={tip} className="inline-flex shrink-0">
            <button
                type="button"
                onClick={onClick}
                disabled={disabled}
                aria-label={children ? undefined : tip}
                // An icon alone says what it does, not to what: the row it sits in says that.
                aria-describedby={children ? undefined : labelId}
                className={`${BASE_CLASS} ${(children ? TEXT_CLASS : ICON_CLASS)[variant ?? 'fill']}`}
            >
                {Icon && <Icon size={14} />}
                {children}
            </button>
        </Tooltip>
    );
};

export default Button;
