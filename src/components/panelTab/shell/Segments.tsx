import React, { useId } from 'react';
import { motion } from 'framer-motion';
import { kitTransition, useKitReducedMotion } from '../../modal/settings/kit/motion';
import { Tooltip } from '../../modal/settings/kit/Tooltip';

// src/components/panelTab/shell/Segments.tsx
// The panel's choice between a few options that are all in view: the tab row, the theme source,
// light or dark. It is the settings kit's Segmented with what the panel needs on top: an icon or a
// mark before the name, an option that shows its icon alone and says its name in a tooltip, a form
// that fills its row, and attributes on each option for the tests and the lessons. The raised mark
// under the chosen option slides to a new choice.

export type Segment<T extends string> = {
    value: T;
    /** The name. Where only the icon shows, it is the tooltip and the accessible name. */
    label: string;
    icon?: React.ReactNode;
    /** Shows the icon without the name. */
    iconOnly?: boolean;
    /** Dimmed and out of reach. */
    disabled?: boolean;
    /** A tooltip in place of the name: why the option is out of reach. */
    tip?: string;
    /** data-* attributes for the option's button. */
    data?: Record<`data-${string}`, string>;
};

const SIZE = {
    s: { box: 'h-7 rounded-lg', option: 'rounded-md', markRadius: 6 },
    m: { box: 'h-8 rounded-lg', option: 'rounded-md', markRadius: 6 },
    l: { box: 'h-9 rounded-[10px]', option: 'rounded-lg', markRadius: 8 },
} as const;

type SegmentsProps<T extends string> = {
    value: T;
    options: ReadonlyArray<Segment<T>>;
    /** Called for a new choice, not for a press on the one already chosen. */
    onChange: (value: T) => void;
    size?: keyof typeof SIZE;
    /** Takes the width of its row; the options share it. */
    fill?: boolean;
};

export const Segments = <T extends string>({ value, options, onChange, size = 'm', fill }: SegmentsProps<T>): React.ReactElement => {
    const markId = useId();
    const reduced = useKitReducedMotion();
    const look = SIZE[size];
    // Where some options show only an icon, they share the room and the named ones take what they need.
    const hasIconOnly = options.some(option => option.iconOnly);

    return (
        <div role="group" className={`${fill ? 'flex w-full' : 'inline-flex'} bg-[var(--st-fill)] p-0.5 ${look.box}`}>
            {options.map((option) => {
                const selected = option.value === value;
                const share = !fill
                    ? `shrink-0${option.iconOnly ? ' w-[30px]' : ''}`
                    : option.iconOnly
                        ? 'min-w-0 flex-[1_1_36px]'
                        : `min-w-0 ${hasIconOnly ? 'flex-[0_1_auto]' : 'flex-[1_1_auto]'}`;
                return (
                    <Tooltip key={option.value} text={option.tip ?? (option.iconOnly ? option.label : undefined)} className={`flex ${share}`}>
                        <button
                            type="button"
                            {...option.data}
                            aria-pressed={selected}
                            aria-label={option.iconOnly ? option.label : undefined}
                            aria-disabled={option.disabled || undefined}
                            onClick={() => {
                                if (!selected && !option.disabled) onChange(option.value);
                            }}
                            className={`st-t-fast st-focus-inside relative flex h-full w-full min-w-0 items-center justify-center whitespace-nowrap text-[13px] transition-[color,opacity] ${look.option} ${option.iconOnly ? '' : 'px-2.5'} ${option.disabled ? 'cursor-not-allowed opacity-40' : ''} ${selected ? 'text-[color:var(--st-t1)]' : `text-[color:var(--st-t2)]${option.disabled ? '' : ' hover:text-[color:var(--st-t1)]'}`}`}
                        >
                            {selected && (
                                // One element shared by the options: framer-motion moves it from the
                                // old choice to the new one, and only when the choice changes.
                                <motion.span
                                    layoutId={markId}
                                    layoutDependency={value}
                                    transition={kitTransition('move', reduced)}
                                    className="absolute inset-0 bg-[var(--st-raise)]"
                                    style={{ borderRadius: look.markRadius, boxShadow: '0 1px 2px rgba(0, 0, 0, 0.2)' }}
                                />
                            )}
                            <span className="relative flex min-w-0 items-center gap-1.5">
                                {option.icon}
                                {!option.iconOnly && <span className="truncate">{option.label}</span>}
                            </span>
                        </button>
                    </Tooltip>
                );
            })}
        </div>
    );
};

export default Segments;
