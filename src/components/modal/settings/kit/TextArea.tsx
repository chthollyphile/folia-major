import React from 'react';
import { useRowAria } from './Row';
import { FIELD_SURFACE_CLASS, useFieldCommit } from './TextField';

// src/components/modal/settings/kit/TextArea.tsx
// A text field of several lines, for a pasted code or a block of text: four lines high, as wide as
// the place it is put in (a row's `below`), in the fixed-width face, and it scrolls inside itself.
// onCommit runs when the field is left with a new text; Enter is a line break here.

type TextAreaProps = {
    value: string;
    onChange: (value: string) => void;
    onCommit?: () => void;
    placeholder?: string;
    disabled?: boolean;
};

export const TextArea: React.FC<TextAreaProps> = ({ value, onChange, onCommit, placeholder, disabled }) => {
    const commit = useFieldCommit(value, onCommit);

    return (
        <textarea
            {...useRowAria()}
            value={value}
            placeholder={placeholder}
            disabled={disabled}
            rows={4}
            spellCheck={false}
            onChange={(event) => {
                commit.typed();
                onChange(event.target.value);
            }}
            onFocus={commit.enter}
            onBlur={commit.finish}
            className={`${FIELD_SURFACE_CLASS} st-scroll block w-full resize-none px-2.5 py-2 font-mono text-xs leading-[18px] disabled:cursor-not-allowed disabled:opacity-40`}
        />
    );
};

export default TextArea;
