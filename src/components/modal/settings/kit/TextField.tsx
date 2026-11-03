import React, { useRef } from 'react';
import { useRowAria } from './Row';

// src/components/modal/settings/kit/TextField.tsx
// A one-line text field. A field whose value should only take effect once it is finished gives
// onCommit, which runs when the field loses focus or Enter is pressed, once for each text typed.

/** The surface of a settings field; the number field and the text area draw the same one. Focus is marked by the border. */
export const FIELD_SURFACE_CLASS = 'st-t-fast max-w-full rounded-lg border border-transparent bg-[var(--st-fill)] text-[color:var(--st-t1)] outline-none transition-colors placeholder:text-[color:var(--st-t3)] focus-within:border-[var(--st-accent)]';

/** A field of one line. */
export const FIELD_CLASS = `${FIELD_SURFACE_CLASS} h-8 text-[13px]`;

/**
 * When a field is finished. `enter` goes on focus, `typed` on each change the user makes and
 * `finish` on blur (and on Enter, in a field of one line). `onCommit` runs only for a text the user
 * changed, other than the one the field was entered with or last committed: Enter and the blur
 * after it are one commit, leaving a field untouched is none, and so is a text that was changed
 * from outside while the field had focus.
 */
export const useFieldCommit = (value: string, onCommit?: () => void) => {
    const baseRef = useRef(value);
    const typedRef = useRef(false);
    return {
        enter: () => {
            baseRef.current = value;
            typedRef.current = false;
        },
        typed: () => {
            typedRef.current = true;
        },
        finish: () => {
            if (onCommit && typedRef.current && baseRef.current !== value) {
                baseRef.current = value;
                typedRef.current = false;
                onCommit();
            }
        },
    };
};

type TextFieldProps = {
    value: string;
    onChange: (value: string) => void;
    onCommit?: () => void;
    type?: 'password' | 'url';
    placeholder?: string;
    disabled?: boolean;
};

export const TextField: React.FC<TextFieldProps> = ({ value, onChange, onCommit, type, placeholder, disabled }) => {
    const commit = useFieldCommit(value, onCommit);

    return (
        <input
            type={type ?? 'text'}
            {...useRowAria()}
            value={value}
            placeholder={placeholder}
            disabled={disabled}
            spellCheck={false}
            onChange={(event) => {
                commit.typed();
                onChange(event.target.value);
            }}
            onFocus={commit.enter}
            onBlur={commit.finish}
            onKeyDown={(event) => {
                // Enter that takes a candidate of an input method (key code 229) is part of the typing.
                if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) commit.finish();
            }}
            className={`${FIELD_CLASS} w-[260px] px-2.5 disabled:cursor-not-allowed disabled:opacity-40`}
        />
    );
};

export default TextField;
