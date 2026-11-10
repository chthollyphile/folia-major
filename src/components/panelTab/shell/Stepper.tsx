import React, { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Tooltip, parseNumberText } from '../../modal/settings/kit';

// src/components/panelTab/shell/Stepper.tsx
// A number set in steps: a minus button, the number with its unit, a plus button. The number can be
// typed too: what is typed counts as soon as it reads as a number, and the field shows the number
// as it is kept once it is left. The up and down arrows step like the two buttons.

const STEP_BUTTON_CLASS = 'st-t-fast st-focus-inside grid h-full w-7 place-items-center rounded-lg text-[color:var(--st-t2)] transition-colors hover:bg-[var(--st-fill2)] hover:text-[color:var(--st-t1)]';

type StepperProps = {
    value: number;
    onChange: (value: number) => void;
    /** How far one press of a button or an arrow key moves the number. */
    step: number;
    /** The name of the number, for a screen reader. */
    label: string;
    /** Shown after the number, and in the tooltips of the two buttons. */
    unit?: string;
    /** Shows a plus before a number above zero. */
    signed?: boolean;
};

export const Stepper: React.FC<StepperProps> = ({ value, onChange, step, label, unit = '', signed }) => {
    /** The text while it is being typed; null when the field shows `value`. */
    const [draft, setDraft] = useState<string | null>(null);

    const stepBy = (direction: 1 | -1) => {
        onChange(value + direction * step);
        setDraft(null);
    };
    const stepButton = (direction: 1 | -1) => {
        const name = `${direction === 1 ? '+' : '-'}${step}${unit}`;
        return (
            <Tooltip text={name} className="flex h-full">
                <button type="button" aria-label={name} onClick={() => stepBy(direction)} className={STEP_BUTTON_CLASS}>
                    {direction === 1 ? <Plus size={14} /> : <Minus size={14} />}
                </button>
            </Tooltip>
        );
    };

    return (
        <span className="st-t-fast inline-flex h-8 shrink-0 items-center rounded-lg border border-transparent bg-[var(--st-fill)] transition-colors has-[input:focus]:border-[var(--st-accent)]">
            {stepButton(-1)}
            <input
                type="text"
                inputMode="numeric"
                role="spinbutton"
                aria-label={label}
                aria-valuenow={value}
                value={draft ?? (signed && value > 0 ? `+${value}` : String(value))}
                spellCheck={false}
                onChange={(event) => {
                    setDraft(event.target.value);
                    const typed = parseNumberText(event.target.value);
                    if (typed !== null) onChange(typed);
                }}
                onBlur={() => setDraft(null)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        setDraft(null);
                    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                        event.preventDefault();
                        stepBy(event.key === 'ArrowUp' ? 1 : -1);
                    }
                }}
                className="h-full w-12 min-w-0 bg-transparent text-right font-mono text-[13px] text-[color:var(--st-t1)] outline-none"
            />
            {unit && <span className="pl-[3px] pr-1 font-mono text-xs text-[color:var(--st-t3)]">{unit}</span>}
            {stepButton(1)}
        </span>
    );
};

export default Stepper;
