import React, { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { parseNumberText } from './numberText';
import { useRowAria } from './Row';
import { FIELD_CLASS } from './TextField';

// src/components/modal/settings/kit/NumberField.tsx
// A field for a number, with a minus and a plus button drawn by the kit in place of the system's
// spinner. Typing is free text until the field is left or Enter is pressed; then a number (a
// decimal comma is fine) is brought inside min and max and handed on, an emptied field hands on
// null, and anything else puts the last value back. The up and down arrows step like the buttons.

const decimalsOf = (value: number) => (String(value).split('.')[1] ?? '').length;

const STEP_BUTTON_CLASS = 'st-t-fast grid h-full w-7 shrink-0 place-items-center text-[color:var(--st-t2)] transition-colors enabled:hover:text-[color:var(--st-t1)] disabled:cursor-not-allowed';

type NumberFieldProps = {
    /** null: nothing is set. */
    value: number | null;
    onChange: (value: number | null) => void;
    min: number;
    max: number;
    step: number;
    /** What an empty field stands for; stepping starts from it. */
    placeholder?: string;
    disabled?: boolean;
};

export const NumberField: React.FC<NumberFieldProps> = ({ value, onChange, min, max, step, placeholder, disabled }) => {
    /** The text while it is being typed; null when the field shows `value`. */
    const [draft, setDraft] = useState<string | null>(null);
    const clamp = (next: number) => Math.min(max, Math.max(min, next));

    const commit = () => {
        if (draft === null) {
            return;
        }
        const typed = parseNumberText(draft);
        if (typed !== null) {
            onChange(clamp(typed));
        } else if (draft.trim() === '') {
            onChange(null);
        }
        setDraft(null);
    };
    const stepBy = (direction: 1 | -1) => {
        const from = (draft === null ? null : parseNumberText(draft)) ?? value ?? parseNumberText(placeholder ?? '') ?? min;
        onChange(clamp(Number((from + direction * step).toFixed(decimalsOf(step)))));
        setDraft(null);
    };
    // The arrow keys do what the two buttons do, so the buttons stay out of the keyboard's way; a
    // press on one does not take the focus out of the field.
    const stepButton = (direction: 1 | -1) => (
        <button
            type="button"
            tabIndex={-1}
            aria-hidden
            disabled={disabled}
            onMouseDown={event => event.preventDefault()}
            onClick={() => stepBy(direction)}
            className={STEP_BUTTON_CLASS}
        >
            {direction === 1 ? <Plus size={14} /> : <Minus size={14} />}
        </button>
    );

    return (
        <span className={`${FIELD_CLASS} inline-flex w-[112px] items-stretch overflow-hidden${disabled ? ' opacity-40' : ''}`}>
            {stepButton(-1)}
            <input
                type="text"
                inputMode="decimal"
                role="spinbutton"
                {...useRowAria()}
                aria-valuemin={min}
                aria-valuemax={max}
                aria-valuenow={value ?? undefined}
                value={draft ?? (value === null ? '' : String(value))}
                placeholder={placeholder}
                disabled={disabled}
                spellCheck={false}
                onChange={event => setDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        commit();
                    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                        event.preventDefault();
                        stepBy(event.key === 'ArrowUp' ? 1 : -1);
                    }
                }}
                className="min-w-0 flex-1 bg-transparent text-center tabular-nums outline-none placeholder:text-[color:var(--st-t3)] disabled:cursor-not-allowed"
            />
            {stepButton(1)}
        </span>
    );
};

export default NumberField;
