import React from 'react';
import { Tooltip } from '../../modal/settings/kit/Tooltip';

// src/components/panelTab/shell/PanelIconButton.tsx
// A button of the panel that is only an icon. Its name is its tooltip (the kit's own, not the
// system's) and what a screen reader says. Out of reach it is dimmed and does nothing, but it still
// takes the pointer and the keyboard, so the tooltip can say why.

const SIZE_CLASS = {
    s: 'h-7 w-7 rounded-lg',
    m: 'h-8 w-8 rounded-lg',
    l: 'h-10 w-10 rounded-[10px]',
} as const;

type PanelIconButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'disabled' | 'title' | 'aria-label' | 'className'> & {
    /** The name: the tooltip and the accessible name. */
    label: string;
    size?: keyof typeof SIZE_CLASS;
    /** Drawn on a filled square instead of bare. */
    filled?: boolean;
    /** For a button that is on or off. */
    pressed?: boolean;
    disabled?: boolean;
    /** For the element that wraps the button: where it sits. */
    className?: string;
    /** The icon. */
    children: React.ReactNode;
};

export const PanelIconButton: React.FC<PanelIconButtonProps> = ({
    label,
    size = 'm',
    filled,
    pressed,
    disabled,
    className,
    onClick,
    children,
    ...button
}) => (
    <Tooltip text={label} className={`inline-flex shrink-0${className ? ` ${className}` : ''}`}>
        <button
            type="button"
            data-glass
            {...button}
            aria-label={label}
            aria-pressed={pressed}
            aria-disabled={disabled || undefined}
            onClick={disabled ? undefined : onClick}
            className={`st-t-fast st-focus-inside grid place-items-center text-[color:var(--st-t2)] transition-[background-color,color,opacity,scale] ${SIZE_CLASS[size]} ${filled ? 'bg-[var(--st-fill)]' : ''} ${disabled
                ? 'cursor-not-allowed opacity-40'
                : `hover:text-[color:var(--st-t1)] active:scale-[0.96] ${filled ? 'hover:bg-[var(--st-fill2)]' : 'hover:bg-[var(--st-fill)]'}`}`}
        >
            {children}
        </button>
    </Tooltip>
);

export default PanelIconButton;
