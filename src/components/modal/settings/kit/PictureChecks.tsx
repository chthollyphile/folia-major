import React, { memo, useLayoutEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import type { PictureState } from './PictureGrid';
import { usePicturesInView } from './usePicturesInView';

// src/components/modal/settings/kit/PictureChecks.tsx
// Several choices among many options that differ in look: PictureGrid's pictures, each one switched
// on and off by itself. A picture that is on has the accent ring and a tick in its corner; one that
// is off is dimmed and has an empty box there. `least` keeps that many on: pressing one of the last
// ones turns nothing off and calls `onRefuse`, so the caller can say why. The frame, the columns,
// the 16px at both sides and the fade of a grid with more rows than its height are PictureGrid's;
// `className="-mx-4"` lines the pictures up with what is above them, as there. Choices drawn as a
// glyph rather than a picture take `compact`: a frame of one low height instead of 16 by 10.
//
// No picture here is the chosen one (PictureState.chosen is false for all): a picture that is on
// still runs under the pointer, as every picture of a grid does that is not the chosen one.
//
// Keyboard: Tab reaches the first picture only; the four arrows move the focus, Home and End jump to
// the first and the last picture. Enter and Space switch the picture that has focus.

/** How much of the grid's lower end fades while more rows follow. */
const FADE = 40;
const FADE_MASK = `linear-gradient(#000 calc(100% - ${FADE}px), transparent)`;

type PictureChecksProps<T extends string> = {
    /** The options that are on, in any order. */
    value: readonly T[];
    options: ReadonlyArray<{ value: T; label: string }>;
    /** Draws what is in a picture's frame; the same function each time (as PictureGrid's). */
    picture: (value: T, state: PictureState) => React.ReactNode;
    columns: number;
    /** The options that are on after a press, in the options' order. */
    onChange: (value: T[]) => void;
    /** What the grid chooses, for a screen reader. */
    label: string;
    /** How many have to stay on. */
    least?: number;
    /** A press that would leave fewer than `least` on. */
    onRefuse?: () => void;
    /** The tallest the grid gets, in px. */
    maxHeight?: number;
    /** Low frames, for choices drawn as a glyph: a glyph keeps its size however wide the frame is. */
    compact?: boolean;
    className?: string;
};

type TileProps<T extends string> = {
    value: T;
    label: string;
    picture: (value: T, state: PictureState) => React.ReactNode;
    on: boolean;
    visible: boolean;
    active: boolean;
    tabStop: boolean;
    compact: boolean;
};

/** One picture with its name and its box. It draws again only when its own state changes. */
const Tile = memo(<T extends string>({ value, label, picture, on, visible, active, tabStop, compact }: TileProps<T>) => (
    <button
        type="button"
        role="checkbox"
        aria-checked={on}
        data-value={value}
        tabIndex={tabStop ? 0 : -1}
        className="group flex min-w-0 flex-col rounded-lg text-xs leading-[18px]"
    >
        <span className={`relative block w-full ${compact ? 'h-14' : 'aspect-[16/10]'}`}>
            <span aria-hidden className={`st-t-fast absolute inset-0 overflow-hidden rounded-lg bg-[var(--st-pv)] transition-[opacity,transform] group-active:scale-[0.97] ${on ? '' : 'opacity-40 group-hover:opacity-70'}`}>
                {picture(value, { visible, chosen: false, active })}
                <span className="pointer-events-none absolute inset-0 rounded-lg shadow-[inset_0_0_0_1px_var(--st-line)]" />
            </span>
            {on && <span aria-hidden className="absolute -inset-[3px] rounded-[11px] shadow-[inset_0_0_0_2px_var(--st-accent)]" />}
            {/* The box, as the kit's Chips draw it, on a dark round so it reads on any picture. */}
            <span aria-hidden className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-black/35">
                <span className={`st-t-fast grid h-4 w-4 place-items-center rounded-[5px] transition-[background-color,box-shadow] ${on ? 'bg-[var(--st-accent)] text-[color:var(--st-on-accent)]' : 'shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.7)]'}`}>
                    <Check size={12} strokeWidth={3} className={`st-t-move transition-[opacity,scale] ${on ? '' : 'scale-50 opacity-0'}`} />
                </span>
            </span>
        </span>
        <span className={`st-t-fast mt-1.5 block w-full truncate text-center transition-colors ${on ? 'font-semibold text-[color:var(--st-t1)]' : 'text-[color:var(--st-t3)] group-hover:text-[color:var(--st-t1)]'}`}>
            {label}
        </span>
    </button>
)) as <T extends string>(props: TileProps<T>) => React.ReactElement;

export const PictureChecks = <T extends string>({
    value, options, picture, columns, onChange, label, least = 0, onRefuse, maxHeight, compact = false, className = '',
}: PictureChecksProps<T>): React.ReactElement => {
    const rootRef = useRef<HTMLDivElement>(null);
    const [pointed, setPointed] = useState<string | null>(null);
    const [focused, setFocused] = useState<string | null>(null);
    const [more, setMore] = useState(false);
    const values = options.map(option => option.value).join('\n');
    const seen = usePicturesInView(rootRef, values);
    const on = new Set<string>(value);
    const focusedAt = focused === null ? -1 : options.findIndex(option => option.value === focused);

    // Whether more rows follow under the part of the grid that shows: then its lower end fades.
    const measure = () => {
        const root = rootRef.current;
        if (root) setMore(root.scrollHeight - root.scrollTop - root.clientHeight > 2);
    };
    useLayoutEffect(() => {
        measure();
        const root = rootRef.current;
        if (!root || typeof ResizeObserver === 'undefined') {
            return undefined;
        }
        const observer = new ResizeObserver(measure);
        observer.observe(root);
        return () => observer.disconnect();
    }, [values, columns]);

    const valueAt = (target: EventTarget) => (target as Element).closest<HTMLElement>('[data-value]')?.dataset.value as T | undefined;

    const toggle = (pressed: T) => {
        if (on.has(pressed)) {
            if (value.length <= least) {
                onRefuse?.();
                return;
            }
            onChange(options.map(option => option.value).filter(option => option !== pressed && on.has(option)));
        } else {
            onChange(options.map(option => option.value).filter(option => option === pressed || on.has(option)));
        }
    };

    // The keys the grid uses stop here, so nothing behind it acts on them as well.
    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const { key } = event;
        // Enter and Space press the picture that has focus; the press itself is left to the browser.
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
        const from = Math.max(0, options.findIndex(option => option.value === valueAt(event.target)));
        let next = key === 'Home' ? 0 : key === 'End' ? last : from + step;
        // Down from above a shorter last row goes to the last picture.
        if (step === columns && next > last && Math.floor(from / columns) < Math.floor(last / columns)) {
            next = last;
        }
        if (next < 0 || next > last || next === from) {
            return;
        }
        event.currentTarget.querySelectorAll<HTMLElement>('[data-value]')[next].focus();
    };

    return (
        <div
            ref={rootRef}
            role="group"
            aria-label={label}
            onClick={(event) => {
                const pressed = valueAt(event.target);
                if (pressed !== undefined) toggle(pressed);
            }}
            onKeyDown={handleKeyDown}
            onFocus={event => setFocused(valueAt(event.target) ?? null)}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null);
            }}
            onPointerOver={event => setPointed(valueAt(event.target) ?? null)}
            onPointerLeave={() => setPointed(null)}
            onScroll={measure}
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
                    on={on.has(option.value)}
                    visible={seen.has(option.value)}
                    active={option.value === pointed}
                    tabStop={index === Math.max(0, focusedAt)}
                    compact={compact}
                />
            ))}
        </div>
    );
};

export default PictureChecks;
