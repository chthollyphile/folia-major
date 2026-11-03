import React, { useId } from 'react';
import { motion } from 'framer-motion';
import { kitTransition, useKitReducedMotion } from './motion';
import { useRowAria } from './Row';

// src/components/modal/settings/kit/PictureChoice.tsx
// A choice between options that differ in look: each is a small picture with its name under it,
// and a frame in the accent colour marks the chosen one and slides to a new choice. The kit gives
// the 96 by 64 frame; the page draws what is in it, in code and with the kit's colour variables.

type PictureChoiceProps<T extends string> = {
    value: T;
    options: ReadonlyArray<{ value: T; label: string; picture: React.ReactNode }>;
    /** Called for a new choice, not for a click on the one already chosen. */
    onChange: (value: T) => void;
    disabled?: boolean;
};

export const PictureChoice = <T extends string>({ value, options, onChange, disabled }: PictureChoiceProps<T>): React.ReactElement => {
    const markId = useId();
    const reduced = useKitReducedMotion();

    return (
        <div role="group" {...useRowAria()} aria-disabled={disabled || undefined} className={`flex max-w-full flex-wrap justify-end gap-3 py-1${disabled ? ' pointer-events-none opacity-40' : ''}`}>
            {options.map(option => {
                const selected = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}
                        disabled={disabled}
                        onClick={() => {
                            if (!selected) onChange(option.value);
                        }}
                        className="group flex min-w-24 max-w-[136px] flex-col items-center gap-1.5 rounded-lg"
                    >
                        <span className="relative block h-16 w-24">
                            <span
                                aria-hidden
                                className={`st-t-fast absolute inset-0 overflow-hidden rounded-lg bg-[var(--st-pv)] shadow-[inset_0_0_0_1px_var(--st-line)] transition-opacity ${selected ? '' : 'opacity-70 group-hover:opacity-100'}`}
                            >
                                {option.picture}
                            </span>
                            {selected && (
                                // One frame shared by the options: framer-motion moves it to the new
                                // choice, and only when the choice changes.
                                <motion.span
                                    layoutId={markId}
                                    layoutDependency={value}
                                    transition={kitTransition('move', reduced)}
                                    className="absolute -inset-[3px] rounded-[11px] shadow-[inset_0_0_0_2px_var(--st-accent)]"
                                />
                            )}
                        </span>
                        <span className={`st-t-fast max-w-full text-center text-xs leading-4 transition-colors ${selected ? 'text-[color:var(--st-t1)]' : 'text-[color:var(--st-t2)] group-hover:text-[color:var(--st-t1)]'}`}>
                            {option.label}
                        </span>
                    </button>
                );
            })}
        </div>
    );
};

export default PictureChoice;
