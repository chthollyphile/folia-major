import React, { useRef } from 'react';
import { useRowAria } from './Row';

// src/components/modal/settings/kit/Slider.tsx
// A slider with its value beside it. The filled part of the track is a gradient cut at --st-p, which
// the input sets from its value. The value is brought onto the track once (inside min and max, on a
// step), and the thumb, the fill, the text beside the track and what a screen reader hears all use
// that one number.
//
// Marks are the values people come back to: small ticks under the track, with a short name under a
// tick where one is given. A drag, or a press on the track, that ends within a few pixels of a mark
// lands on it; the arrow keys still move by the step, and every value between the marks stays
// possible. A press on a mark's name goes to that mark. Names need room: those of marks closer
// together than the names are wide run into each other.
//
// Stacked, for a narrow column: alone in its Row, the value ends the label's line and the track
// spans the row under it (kit.css lets the two parts lie in the row itself).

/** The thumb is 16px wide: its centre stops this far inside each end of the track. */
const THUMB_INSET = 8;
/** How near a mark, in px, the thumb has to be to land on it. */
const MARK_REACH = 6;

const RANGE_CLASS = [
    'st-slider block h-5 min-w-0 max-w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed',
    '[&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full',
    '[&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,var(--st-accent)_var(--st-p),var(--st-track)_var(--st-p))]',
    '[&::-webkit-slider-thumb]:-mt-1.5 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none',
    '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white',
    '[&::-webkit-slider-thumb]:shadow-[0_0_0_1px_rgba(0,0,0,0.14),0_1px_3px_rgba(0,0,0,0.35)]',
    '[&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-[var(--st-track)]',
    '[&::-moz-range-progress]:h-1 [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-[var(--st-accent)]',
    '[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white',
].join(' ');

const decimalsOf = (value: number) => (String(value).split('.')[1] ?? '').length;

/** `value` as the track can show it: inside min and max, on a step counted from min. */
const onTrack = (value: number, min: number, max: number, step: number): number => {
    const stepped = min + Math.round((Math.min(max, Math.max(min, value)) - min) / step) * step;
    return Number(Math.min(max, stepped).toFixed(Math.max(decimalsOf(step), decimalsOf(min))));
};

/** Where a drag lands: on the nearest mark when the thumb is within `reach` of it (in the value's unit), else where the thumb is. */
export const landOnMark = (value: number, marks: ReadonlyArray<number>, reach: number): number => {
    const nearest = marks.reduce<number | null>((best, mark) => (
        best === null || Math.abs(mark - value) < Math.abs(best - value) ? mark : best
    ), null);
    return nearest !== null && Math.abs(nearest - value) <= reach ? nearest : value;
};

type SliderProps = {
    value: number;
    min: number;
    max: number;
    step?: number;
    onChange: (value: number) => void;
    /** How the value reads beside the track, e.g. `v => `${v}%``. */
    format: (value: number) => string;
    /** Values the track marks with a tick; one the slider cannot take is moved to the nearest it can. `label` is a short name under the tick. */
    marks?: ReadonlyArray<{ value: number; label?: string }>;
    /** For a narrow column, alone in its Row: the value ends the label's line, the track spans the row. */
    stacked?: boolean;
    disabled?: boolean;
};

export const Slider: React.FC<SliderProps> = ({ value, min, max, step = 1, onChange, format, marks, stacked, disabled }) => {
    // A pointer is moving the thumb: only then does the value land on marks.
    const dragging = useRef(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const aria = useRowAria();
    const shown = onTrack(value, min, max, step);
    const filled = max > min ? ((shown - min) / (max - min)) * 100 : 0;
    // Each mark where the track can show it: what the thumb lands on and what a press on its name sets.
    const stops = marks?.map(mark => ({ value: onTrack(mark.value, min, max, step), label: mark.label }));
    const named = stops?.some(mark => mark.label !== undefined) ?? false;
    const dim = disabled ? ' opacity-40' : '';
    const text = format(shown);

    const track = (
        <>
            {stops && max > min && (
                // As wide as the thumb's travel, and under the input (which is `relative` for this): the
                // thumb covers the tick it stands on.
                <span aria-hidden className="pointer-events-none absolute inset-x-2 top-0">
                    {stops.map((mark) => {
                        const left = `${((mark.value - min) / (max - min)) * 100}%`;
                        return (
                            <React.Fragment key={mark.value}>
                                <span className="absolute top-3.5 h-1 w-px -translate-x-1/2 bg-[var(--st-t3)]" style={{ left }} />
                                {mark.label !== undefined && (
                                    <button
                                        type="button"
                                        tabIndex={-1}
                                        disabled={disabled}
                                        // The name takes no focus (it is hidden from assistive tech): the
                                        // slider gets it, so the arrow keys go on from the mark.
                                        onMouseDown={event => event.preventDefault()}
                                        onClick={() => {
                                            inputRef.current?.focus();
                                            if (shown !== mark.value) onChange(mark.value);
                                        }}
                                        className={`st-t-fast pointer-events-auto absolute top-[22px] -translate-x-1/2 whitespace-nowrap text-[11px] leading-[14px] transition-colors enabled:hover:text-[color:var(--st-t1)] ${shown === mark.value ? 'text-[color:var(--st-t1)]' : 'text-[color:var(--st-t3)]'}`}
                                        style={{ left }}
                                    >
                                        {mark.label}
                                    </button>
                                )}
                            </React.Fragment>
                        );
                    })}
                </span>
            )}
            <input
                ref={inputRef}
                type="range"
                {...aria}
                aria-valuetext={text}
                min={min}
                max={max}
                step={step}
                value={shown}
                disabled={disabled}
                onPointerDown={() => {
                    dragging.current = true;
                }}
                onPointerUp={() => {
                    dragging.current = false;
                }}
                onPointerCancel={() => {
                    dragging.current = false;
                }}
                // A pointer let go outside the slider may not say so here.
                onBlur={() => {
                    dragging.current = false;
                }}
                onKeyDown={() => {
                    dragging.current = false;
                }}
                onChange={(event) => {
                    const next = Number(event.currentTarget.value);
                    if (!dragging.current || !stops) {
                        onChange(next);
                        return;
                    }
                    // MARK_REACH px of the thumb's travel, in the value's unit.
                    const reach = ((max - min) * MARK_REACH) / Math.max(1, event.currentTarget.offsetWidth - 2 * THUMB_INSET);
                    onChange(landOnMark(next, stops.map(mark => mark.value), reach));
                }}
                className={`${RANGE_CLASS} ${stacked ? 'w-full' : 'w-[200px]'}${stops ? ' relative' : ''}`}
                style={{ '--st-p': `${filled}%` } as React.CSSProperties}
            />
        </>
    );

    if (stacked) {
        return (
            <span className="st-slider-stacked">
                <output className={`ml-auto shrink-0 text-[13px] text-[color:var(--st-t2)] tabular-nums${dim}`}>{text}</output>
                <span className={`relative mb-1 mt-1.5 min-w-0 basis-full${named ? ' pb-4' : ''}${dim}`}>{track}</span>
            </span>
        );
    }

    return (
        <span className={`flex min-w-0 gap-3 ${named ? 'items-start' : 'items-center'}${dim}`}>
            <span className={`relative min-w-0${named ? ' pb-4' : ''}`}>{track}</span>
            <output className={`w-[52px] shrink-0 text-right text-[13px] text-[color:var(--st-t1)] tabular-nums${named ? ' leading-5' : ''}`}>
                {text}
            </output>
        </span>
    );
};

export default Slider;
