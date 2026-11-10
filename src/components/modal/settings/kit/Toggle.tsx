import React from 'react';
import { useRowAria } from './Row';

// src/components/modal/settings/kit/Toggle.tsx
// The on/off switch of a settings row. Named by the row it sits in, or by `labelledBy`. The thumb glides to its side
// and widens while the switch is pressed.

type ToggleProps = {
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
    /** The id of what names it, where it sits outside a settings row. */
    labelledBy?: string;
};

export const Toggle: React.FC<ToggleProps> = ({ checked, onChange, disabled, labelledBy }) => (
    <button
        type="button"
        role="switch"
        aria-checked={checked}
        {...useRowAria()}
        {...(labelledBy ? { 'aria-labelledby': labelledBy } : {})}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`st-t-move group relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${checked ? 'bg-[var(--st-accent)]' : 'bg-[var(--st-track)]'}`}
    >
        <span
            className={`st-t-move absolute left-[3px] top-[3px] h-[18px] w-[18px] rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.3)] transition-[translate,width,background-color] group-enabled:group-active:w-[22px] ${checked ? 'translate-x-4 bg-[var(--st-on-accent)] group-enabled:group-active:translate-x-3' : 'bg-[var(--st-knob)]'}`}
        />
    </button>
);

export default Toggle;
