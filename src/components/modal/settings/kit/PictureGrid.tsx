import React, { memo, useId, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { kitTransition, useKitReducedMotion } from './motion';
import { usePicturesInView } from './usePicturesInView';

// src/components/modal/settings/kit/PictureGrid.tsx
// A choice among many options that differ in look: pictures in a fixed number of columns, each
// with its name under it. One ring in the accent colour marks the chosen picture and slides to a
// new choice. The grid gives the 16 by 10 frame and the caller draws what is in it; for each
// picture the caller is told whether a person can see it at this moment, so a picture that moves
// can run only then. With more rows than its height holds, the grid scrolls inside itself and the
// last row in view fades.
//
// It keeps 16px free at both sides: room for the ring and for its scrollbar. Where that room is
// there already, `className="-mx-4"` lines the pictures up with what is above them.
//
// Keyboard: Tab reaches the chosen picture only; the four arrows move the choice from the picture
// that has focus, Home and End jump to the first and the last picture. A grid whose choices are not
// to be passed through on the way (`arrowKeys="focus"`) moves only the focus with those keys: Enter,
// Space or a press chooses, and Tab stays with the picture that has focus.

/** Around the pictures, inside the grid: the ring is drawn 3px outside its picture. */
const RING_ROOM = 4;
/** How much of the grid's lower end fades while more rows follow. */
const FADE = 40;
const FADE_MASK = `linear-gradient(#000 calc(100% - ${FADE}px), transparent)`;

export type PictureState = {
    /** On screen at this moment: in the part of the grid that shows, in a grid that is itself in view. */
    visible: boolean;
    chosen: boolean;
    /** The pointer is on it. */
    active: boolean;
};

type PictureGridProps<T extends string> = {
    value: T;
    options: ReadonlyArray<{ value: T; label: string }>;
    /**
     * Draws what is in a picture's frame. It is called again when that picture's state changes, and
     * for every picture when the function itself is a new one: give the same function each time (one
     * defined outside the component, or a useCallback).
     */
    picture: (value: T, state: PictureState) => React.ReactNode;
    columns: number;
    /** Called for a new choice, not for a click on the one already chosen. */
    onChange: (value: T) => void;
    /** What the grid chooses, for a screen reader. */
    label: string;
    /** The tallest the grid gets, in px. */
    maxHeight?: number;
    /** 'focus': the arrow keys, Home and End move the focus and choose nothing. Left out, they choose. */
    arrowKeys?: 'choose' | 'focus';
    className?: string;
};

type TileProps<T extends string> = PictureState & {
    value: T;
    label: string;
    picture: (value: T, state: PictureState) => React.ReactNode;
    /** Tab lands here. */
    tabStop: boolean;
    markId: string;
    reduced: boolean;
};

/** One picture with its name. It draws again only when its own state changes, not with every other tile. */
const Tile = memo(<T extends string>({ value, label, picture, tabStop, markId, reduced, ...state }: TileProps<T>) => (
    <button
        type="button"
        role="radio"
        aria-checked={state.chosen}
        data-value={value}
        tabIndex={tabStop ? 0 : -1}
        className="group flex min-w-0 flex-col rounded-lg text-xs leading-[18px]"
    >
        <span className="relative block aspect-[16/10] w-full">
            <span aria-hidden className="st-t-fast absolute inset-0 overflow-hidden rounded-lg bg-[var(--st-pv)] transition-transform group-active:scale-[0.97]">
                {picture(value, state)}
                <span className="pointer-events-none absolute inset-0 rounded-lg shadow-[inset_0_0_0_1px_var(--st-line)]" />
            </span>
            {state.chosen && (
                // One ring shared by the pictures: framer-motion moves it to the new choice.
                <motion.span
                    layoutId={markId}
                    layoutDependency={value}
                    transition={kitTransition('move', reduced)}
                    className="absolute -inset-[3px] rounded-[11px] shadow-[inset_0_0_0_2px_var(--st-accent)]"
                />
            )}
        </span>
        <span className={`st-t-fast mt-1.5 block w-full truncate text-center transition-colors ${state.chosen ? 'font-semibold text-[color:var(--st-t1)]' : 'text-[color:var(--st-t2)] group-hover:text-[color:var(--st-t1)]'}`}>
            {label}
        </span>
    </button>
)) as <T extends string>(props: TileProps<T>) => React.ReactElement;

export const PictureGrid = <T extends string>({ value, options, picture, columns, onChange, label, maxHeight, arrowKeys = 'choose', className = '' }: PictureGridProps<T>): React.ReactElement => {
    const markId = useId();
    const reduced = useKitReducedMotion();
    const rootRef = useRef<HTMLDivElement>(null);
    const [pointed, setPointed] = useState<string | null>(null);
    const [more, setMore] = useState(false);
    // Where the keys only move the focus: the picture that has it, while the focus is in the grid.
    const [focused, setFocused] = useState<string | null>(null);
    // The options as one text: what the effects below depend on, whatever array holds them.
    const values = options.map(option => option.value).join('\n');
    const chosenAt = options.findIndex(option => option.value === value);
    const focusedAt = focused === null ? -1 : options.findIndex(option => option.value === focused);
    const tabStopAt = focusedAt >= 0 ? focusedAt : Math.max(0, chosenAt);

    // Which pictures are on screen (usePicturesInView.ts).
    const seen = usePicturesInView(rootRef, values);

    // Where `settle` left the grid's scroll; null once a person has scrolled it since.
    const settledTop = useRef<number | null>(null);

    // Brings the chosen picture into the part of the grid that shows, clear of the fade, and says
    // whether more rows follow under that part.
    const settle = (reveal: boolean) => {
        const root = rootRef.current;
        const tile = root?.querySelector<HTMLElement>('[aria-checked="true"]');
        if (!root) {
            return;
        }
        if (reveal && tile) {
            if (tile.offsetTop - RING_ROOM < root.scrollTop) {
                root.scrollTop = tile.offsetTop - RING_ROOM;
            } else if (tile.offsetTop + tile.offsetHeight > root.scrollTop + root.clientHeight - FADE) {
                root.scrollTop = tile.offsetTop + tile.offsetHeight - root.clientHeight + FADE;
            }
        }
        if (reveal) {
            settledTop.current = root.scrollTop;
        }
        setMore(root.scrollHeight - root.scrollTop - root.clientHeight > 2);
    };

    // On a new choice and a new set of options. A new size of the grid (a popover that is placed
    // after its grid was drawn gives it a smaller height) brings the chosen picture back into view
    // only while nobody has scrolled the grid: it does not scroll a grid a person is looking through.
    useLayoutEffect(() => {
        const root = rootRef.current;
        settle(true);
        if (!root || typeof ResizeObserver === 'undefined') {
            return undefined;
        }
        const observer = new ResizeObserver(() => settle(settledTop.current !== null));
        observer.observe(root);
        return () => observer.disconnect();
    }, [value, values, columns]);

    const valueAt = (target: EventTarget) => (target as Element).closest<HTMLElement>('[data-value]')?.dataset.value as T | undefined;

    // The keys the grid uses stop here, so nothing behind it acts on them as well.
    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const { key } = event;
        // Enter and Space press the picture that has focus: nothing behind the grid acts on them (the
        // playing page's own keys), and the press itself is left to the browser.
        if (key === 'Enter' || key === ' ') {
            event.stopPropagation();
            return;
        }
        const last = options.length - 1;
        const step = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : key === 'ArrowDown' ? columns : key === 'ArrowUp' ? -columns : 0;
        if ((!step && key !== 'Home' && key !== 'End') || event.altKey || event.ctrlKey || event.metaKey) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        // Counted from the picture that has focus: the chosen one, unless the caller has not taken the last choice yet.
        const keyAt = options.findIndex(option => option.value === valueAt(event.target));
        const from = keyAt >= 0 ? keyAt : chosenAt;
        let next = key === 'Home' ? 0 : key === 'End' ? last : Math.max(0, from) + (from < 0 ? 0 : step);
        // Down from above a shorter last row goes to the last picture.
        if (step === columns && next > last && Math.floor(from / columns) < Math.floor(last / columns)) {
            next = last;
        }
        if (next < 0 || next > last || next === from) {
            return;
        }
        event.currentTarget.querySelectorAll<HTMLElement>('[data-value]')[next].focus();
        if (arrowKeys === 'choose' && next !== chosenAt) onChange(options[next].value);
    };

    return (
        // layoutScroll: the ring is measured inside a grid that may be scrolled.
        <motion.div
            ref={rootRef}
            layoutScroll
            role="radiogroup"
            aria-label={label}
            onClick={(event) => {
                const next = valueAt(event.target);
                if (next !== undefined && next !== value) onChange(next);
            }}
            onKeyDown={handleKeyDown}
            onFocus={arrowKeys === 'focus' ? event => setFocused(valueAt(event.target) ?? null) : undefined}
            onBlur={arrowKeys === 'focus' ? (event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null);
            } : undefined}
            onPointerOver={event => setPointed(valueAt(event.target) ?? null)}
            onPointerLeave={() => setPointed(null)}
            onScroll={(event) => {
                if (settledTop.current !== null && Math.abs(event.currentTarget.scrollTop - settledTop.current) > 1) {
                    settledTop.current = null;
                }
                settle(false);
            }}
            style={{
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                maxHeight,
                ...(more ? { maskImage: FADE_MASK, WebkitMaskImage: FADE_MASK } : {}),
            }}
            className={`st-scroll relative grid min-h-0 content-start gap-3 overflow-y-auto overscroll-contain p-1 [scrollbar-gutter:stable_both-edges] ${className}`}
        >
            {options.map((option, index) => (
                <Tile
                    key={option.value}
                    value={option.value}
                    label={option.label}
                    picture={picture}
                    visible={seen.has(option.value)}
                    chosen={index === chosenAt}
                    active={option.value === pointed}
                    tabStop={index === tabStopAt}
                    markId={markId}
                    reduced={reduced}
                />
            ))}
        </motion.div>
    );
};

export default PictureGrid;
