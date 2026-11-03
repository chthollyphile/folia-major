import React, { useId, useState } from 'react';
import { motion } from 'framer-motion';
import { Star } from 'lucide-react';
import { kitTransition, useKitReducedMotion } from '../../kit';

// src/components/modal/settings/pages/desktop/DisplayMap.tsx
// A choice among the connected displays, drawn as a small map of how they are arranged: each
// display a rectangle at its place and in its proportion, with its number, its resolution and a
// mark on the primary one. Before the map stands "automatic", whose picture is the same
// arrangement with the display in use now filled in. The chosen option wears the accent frame of
// the kit's picture controls (PictureChoice), and the frame slides to a new choice.
//
// Keyboard: a radio group. Tab reaches the chosen option only; the arrows, Home and End move the
// focus and choose nothing, Enter or Space chooses. A choice can rebuild the wallpaper window, so
// the options between two choices are not passed through on the way.

/** The most room the map takes, in px: displays side by side meet the width, displays one above another the height. */
const MAP_WIDTH = 264;
const MAP_HEIGHT = 120;
/**
 * With many displays the map grows past that, up to this, until the smallest display has the room
 * of MAP_MIN_BOX: four or more side by side would otherwise lose their resolution, and then their
 * number, and be hard to hit.
 */
const MAP_GROWN = { width: 480, height: 200 };
/** A display's rectangle, frame included, that holds its number over a one-line resolution (fitText). */
const MAP_MIN_BOX = { width: 70, height: 40 };
/** The arrangement inside the 96 by 64 frame of "automatic". */
const MINI_WIDTH = 68;
const MINI_HEIGHT = 40;
/** Free space around a display in the map: half the gap to its neighbour, and the room of the frame. */
const GAP = 3;
const AUTO = 'auto';

type Box = { left: number; top: number; width: number; height: number };

/**
 * The displays' arrangement scaled to fit `maxWidth` by `maxHeight`: one box per display, in whole px.
 * Given `grow`, the scale rises where the smallest box would be under `grow.minBox`, but no further
 * than `grow.max` allows.
 */
const arrange = (
    displays: ReadonlyArray<ElectronWallpaperDisplay>,
    maxWidth: number,
    maxHeight: number,
    grow?: { minBox: { width: number; height: number }; max: { width: number; height: number } },
): { width: number; height: number; boxes: Box[] } => {
    const left = Math.min(...displays.map(display => display.bounds.x));
    const top = Math.min(...displays.map(display => display.bounds.y));
    const right = Math.max(...displays.map(display => display.bounds.x + display.bounds.width));
    const bottom = Math.max(...displays.map(display => display.bounds.y + display.bounds.height));
    const fitted = Math.min(maxWidth / (right - left), maxHeight / (bottom - top));
    const roomy = grow && Math.max(...displays.map(({ bounds }) => Math.max(grow.minBox.width / bounds.width, grow.minBox.height / bounds.height)));
    const scale = grow && roomy && roomy > fitted
        ? Math.min(roomy, grow.max.width / (right - left), grow.max.height / (bottom - top))
        : fitted;
    const at = (value: number, origin: number) => Math.round((value - origin) * scale);
    return {
        width: at(right, left),
        height: at(bottom, top),
        boxes: displays.map(({ bounds }) => ({
            left: at(bounds.x, left),
            top: at(bounds.y, top),
            width: at(bounds.x + bounds.width, left) - at(bounds.x, left),
            height: at(bounds.y + bounds.height, top) - at(bounds.y, top),
        })),
    };
};

const share = (part: number, whole: number) => `${(part / whole) * 100}%`;

/** Left to right, then top to bottom: the order the displays are numbered in. */
const byPlace = (a: ElectronWallpaperDisplay, b: ElectronWallpaperDisplay) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y;

/** A display's resolution in its own pixels, the number a person knows the monitor by. */
const resolutionOf = ({ bounds, scaleFactor }: ElectronWallpaperDisplay) => ({
    width: Math.round(bounds.width * scaleFactor),
    height: Math.round(bounds.height * scaleFactor),
});

/** Line heights in a display's rectangle: its number, and a line of small text. */
const NUMBER_LINE = 16;
const TEXT_LINE = 12;

/** What fits in a display's rectangle under its number: the resolution on one line or two, and the word for "primary". */
const fitText = (width: number, height: number) => {
    const resolutionLines = width >= 64 ? 1 : 2;
    const room = height - 6;
    const resolution = width >= 36 && NUMBER_LINE + resolutionLines * TEXT_LINE <= room;
    return {
        resolution,
        primaryWord: resolution && width >= 48 && NUMBER_LINE + (resolutionLines + 1) * TEXT_LINE <= room,
    };
};

type DisplayMapProps = {
    displays: ReadonlyArray<ElectronWallpaperDisplay>;
    /** The chosen display's id, or null for automatic. Undefined marks nothing: the chosen display is not connected. */
    value: number | null | undefined;
    /** The display in use now, filled in in the picture of "automatic" while no connected display is chosen. */
    activeId: number | null;
    /** Called for a new choice, not for a click on the one already chosen. */
    onChange: (value: number | null) => void;
    /** What the map chooses, for a screen reader. */
    label: string;
    autoLabel: string;
    primaryLabel: string;
};

export const DisplayMap: React.FC<DisplayMapProps> = ({ displays, value, activeId, onChange, label, autoLabel, primaryLabel }) => {
    const markId = useId();
    const reduced = useKitReducedMotion();
    // The option that has the keyboard focus, while the focus is in the group.
    const [focused, setFocused] = useState<string | null>(null);
    const ordered = [...displays].sort(byPlace);
    const map = arrange(ordered, MAP_WIDTH, MAP_HEIGHT, { minBox: MAP_MIN_BOX, max: MAP_GROWN });
    const mini = arrange(ordered, MINI_WIDTH, MINI_HEIGHT);
    const chosen = value === null ? AUTO : value === undefined ? null : String(value);
    const tabStop = focused ?? chosen ?? AUTO;
    const autoChosen = chosen === AUTO;

    // One frame shared by the options: framer-motion moves it to the new choice, and only when the
    // choice changes. Radius and shadow are in `style` so it keeps them true while it stretches
    // between options of different sizes.
    const mark = (
        <motion.span
            layoutId={markId}
            layoutDependency={chosen}
            transition={kitTransition('move', reduced)}
            className="pointer-events-none absolute -inset-[3px]"
            style={{ borderRadius: 11, boxShadow: 'inset 0 0 0 2px var(--st-accent)' }}
        />
    );

    // The keys the group uses stop here, so nothing behind it acts on them as well.
    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const { key } = event;
        if (key === 'Enter' || key === ' ') {
            event.stopPropagation();
            return;
        }
        const step = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 0;
        if ((!step && key !== 'Home' && key !== 'End') || event.altKey || event.ctrlKey || event.metaKey) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const options = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
        const from = options.indexOf(event.target as HTMLElement);
        const next = key === 'Home' ? 0 : key === 'End' ? options.length - 1 : from + step;
        options[Math.max(0, Math.min(options.length - 1, next))]?.focus();
    };

    return (
        <div
            role="radiogroup"
            aria-label={label}
            onKeyDown={handleKeyDown}
            onFocus={event => setFocused((event.target as HTMLElement).dataset.option ?? null)}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null);
            }}
            className="flex max-w-full flex-wrap items-start justify-end gap-3 py-1"
        >
            <button
                type="button"
                role="radio"
                aria-checked={autoChosen}
                data-option={AUTO}
                tabIndex={tabStop === AUTO ? 0 : -1}
                onClick={() => {
                    if (value !== null) onChange(null);
                }}
                className="group flex flex-col items-center gap-1.5 rounded-lg"
            >
                <span className="relative block h-16 w-24">
                    <span
                        aria-hidden
                        className={`st-t-fast absolute inset-0 grid place-items-center overflow-hidden rounded-lg bg-[var(--st-pv)] shadow-[inset_0_0_0_1px_var(--st-line)] transition-opacity ${autoChosen ? '' : 'opacity-70 group-hover:opacity-100'}`}
                    >
                        <span className="relative block" style={{ width: mini.width, height: mini.height }}>
                            {ordered.map((display, index) => {
                                const box = mini.boxes[index];
                                const inUse = typeof value !== 'number' && display.id === activeId;
                                return (
                                    <span
                                        key={display.id}
                                        data-in-use={inUse || undefined}
                                        className={`absolute rounded-[3px] ${inUse ? 'bg-[var(--st-t2)]' : 'bg-[var(--st-fill2)]'}`}
                                        style={{ left: box.left + 1, top: box.top + 1, width: box.width - 2, height: box.height - 2 }}
                                    />
                                );
                            })}
                        </span>
                    </span>
                    {autoChosen && mark}
                </span>
                <span className={`st-t-fast max-w-full text-center text-xs leading-4 transition-colors ${autoChosen ? 'text-[color:var(--st-t1)]' : 'text-[color:var(--st-t2)] group-hover:text-[color:var(--st-t1)]'}`}>
                    {autoLabel}
                </span>
            </button>

            {/* Places and sizes are shares of the map, so a row narrower than the map shrinks it whole. */}
            <div className="relative max-w-full" style={{ width: map.width, aspectRatio: `${map.width} / ${map.height}`, margin: -GAP }}>
                {ordered.map((display, index) => {
                    const box = map.boxes[index];
                    const width = box.width - GAP * 2;
                    const height = box.height - GAP * 2;
                    const option = String(display.id);
                    const isChosen = chosen === option;
                    const resolution = resolutionOf(display);
                    const fit = fitText(width, height);
                    const name = [index + 1, `${resolution.width} × ${resolution.height}`, display.primary ? primaryLabel : '', display.label].filter(Boolean).join(', ');
                    return (
                        <button
                            key={display.id}
                            type="button"
                            role="radio"
                            aria-checked={isChosen}
                            aria-label={name}
                            data-option={option}
                            tabIndex={tabStop === option ? 0 : -1}
                            onClick={() => {
                                if (!isChosen) onChange(display.id);
                            }}
                            className="group absolute rounded-lg"
                            style={{
                                left: `calc(${share(box.left, map.width)} + ${GAP}px)`,
                                top: `calc(${share(box.top, map.height)} + ${GAP}px)`,
                                width: `calc(${share(box.width, map.width)} - ${GAP * 2}px)`,
                                height: `calc(${share(box.height, map.height)} - ${GAP * 2}px)`,
                                zIndex: isChosen ? 1 : undefined,
                            }}
                        >
                            <span
                                aria-hidden
                                className={`st-t-fast absolute inset-0 flex flex-col items-center justify-center overflow-hidden rounded-lg bg-[var(--st-pv)] text-[color:var(--st-t2)] shadow-[inset_0_0_0_1px_var(--st-line)] transition-opacity ${isChosen ? '' : 'opacity-70 group-hover:opacity-100'}`}
                            >
                                <span className="flex items-center gap-1 text-[15px] font-semibold leading-4 text-[color:var(--st-t1)]">
                                    {index + 1}
                                    {display.primary && !fit.primaryWord && <Star size={9} fill="currentColor" className="text-[color:var(--st-t2)]" />}
                                </span>
                                {fit.resolution && (
                                    <span className="max-w-full px-1 text-center text-[10px] leading-3 tabular-nums">
                                        {resolution.width}×<wbr />{resolution.height}
                                    </span>
                                )}
                                {display.primary && fit.primaryWord && (
                                    <span className="max-w-full truncate px-1 text-[10px] leading-3">{primaryLabel}</span>
                                )}
                            </span>
                            {isChosen && mark}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default DisplayMap;
