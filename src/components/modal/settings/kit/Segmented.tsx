import React, { useId } from 'react';
import { motion } from 'framer-motion';
import { kitTransition, useKitReducedMotion } from './motion';
import { useRowAria } from './Row';

// src/components/modal/settings/kit/Segmented.tsx
// A choice between two to four short options, all of them in view. The raised mark under the
// chosen one slides to a new choice. It is as wide as its options need, or, asked to fill, as wide
// as the place it is in.

type SegmentedProps<T extends string> = {
    /** The chosen value; none is marked when it is not among the options. */
    value: T;
    /** `icon`: a small picture before the option's label. */
    options: ReadonlyArray<{ value: T; label: string; disabled?: boolean; icon?: React.ReactNode }>;
    /** Called for a new choice, not for a click on the one already chosen. */
    onChange: (value: T) => void;
    /** As wide as the place it is in, each option an equal share of it. */
    fill?: boolean;
    /** The whole choice is dimmed and out of reach; one option alone has its own `disabled`. */
    disabled?: boolean;
};

export const Segmented = <T extends string>({ value, options, onChange, fill, disabled }: SegmentedProps<T>): React.ReactElement => {
    const markId = useId();
    const reduced = useKitReducedMotion();

    return (
        <div
            role="group"
            {...useRowAria()}
            aria-disabled={disabled || undefined}
            className={`${fill ? 'flex w-full' : 'inline-flex max-w-full flex-wrap'} min-h-8 rounded-lg bg-[var(--st-fill)] p-0.5${disabled ? ' pointer-events-none opacity-40' : ''}`}
        >
            {options.map(option => {
                const selected = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}
                        disabled={disabled || option.disabled}
                        onClick={() => {
                            if (!selected) onChange(option.value);
                        }}
                        className={`st-t-fast relative h-7 whitespace-nowrap rounded-md text-[13px] transition-colors disabled:cursor-not-allowed ${fill ? 'min-w-0 flex-1 px-1.5' : 'px-3'}${option.disabled ? ' opacity-40' : ''} ${selected ? 'text-[color:var(--st-t1)]' : 'text-[color:var(--st-t2)] enabled:hover:text-[color:var(--st-t1)]'}`}
                    >
                        {selected && (
                            // One element shared by the options: framer-motion moves it from the old
                            // choice to the new one, and only when the choice changes. Radius and
                            // shadow are in `style` so it can keep them true while it stretches
                            // between options of different widths.
                            <motion.span
                                layoutId={markId}
                                layoutDependency={value}
                                transition={kitTransition('move', reduced)}
                                className="absolute inset-0 bg-[var(--st-raise)]"
                                style={{ borderRadius: 6, boxShadow: '0 1px 2px rgba(0, 0, 0, 0.2)' }}
                            />
                        )}
                        {option.icon
                            ? <span className="relative inline-flex min-w-0 items-center gap-1.5">{option.icon}<span className="truncate">{option.label}</span></span>
                            : <span className={fill ? 'relative block truncate' : 'relative'}>{option.label}</span>}
                    </button>
                );
            })}
        </div>
    );
};

export default Segmented;
