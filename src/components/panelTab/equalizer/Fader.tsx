import React, { useRef, useState } from 'react';

// src/components/panelTab/equalizer/Fader.tsx
// A vertical slider drawn by the app, for one band's gain: a track, a fill from the middle of the
// track to the thumb, and the thumb. It is as tall as its place. The value is tried out while the
// thumb moves and kept when it is let go: every new value calls onPreview, and letting go (the
// pointer, a key, or focus leaving) calls onCommit, which may come more than once for one hold.
//
// The pointer is kept from the press to the release, also outside the part: the thumb follows it
// with no delay and grows a little while it is held. A press on the track brings the thumb there;
// a press on the thumb takes it where it is and sends no value until it is moved.
// Keyboard: the arrows move one step, with Shift ten; Home and End go to the two ends.

const THUMB_PX = 16;

export type FaderScale = { min: number; max: number; step: number };

/** `value` as the fader can take it: inside min and max, on a step counted from min. */
const onScale = (value: number, { min, max, step }: FaderScale): number => {
    const stepped = min + Math.round((Math.min(max, Math.max(min, value)) - min) / step) * step;
    return Number(Math.min(max, stepped).toFixed(4));
};

/**
 * The value under a pointer `offset` px below the top of a fader `length` px tall. The top end is
 * max. The thumb's centre follows the pointer, so it stops half a thumb inside each end.
 */
export const faderValueAt = (offset: number, length: number, scale: FaderScale): number => {
    const travel = length - THUMB_PX;
    const fromTop = travel > 0 ? Math.min(1, Math.max(0, (offset - THUMB_PX / 2) / travel)) : 0.5;
    return onScale(scale.max - fromTop * (scale.max - scale.min), scale);
};

/** Where a key moves the fader from `value`, or null for a key that is not the fader's. */
export const faderKeyValue = (key: string, shift: boolean, value: number, scale: FaderScale): number | null => {
    const by = scale.step * (shift ? 10 : 1);
    switch (key) {
        case 'ArrowUp':
        case 'ArrowRight':
            return onScale(value + by, scale);
        case 'ArrowDown':
        case 'ArrowLeft':
            return onScale(value - by, scale);
        case 'Home':
            return scale.min;
        case 'End':
            return scale.max;
        default:
            return null;
    }
};

type FaderProps = {
    value: number;
    min: number;
    max: number;
    step?: number;
    /** The accessible name. */
    label: string;
    /** How the value reads, e.g. "+3 dB". */
    valueText: string;
    onPreview: (value: number) => void;
    onCommit: () => void;
    /** The value came from outside (a preset): the thumb glides to it. Moved by hand it is there at once. */
    glide?: boolean;
};

export const Fader: React.FC<FaderProps> = ({ value, min, max, step = 1, label, valueText, onPreview, onCommit, glide = false }) => {
    const [isHeld, setIsHeld] = useState(false);
    const scale: FaderScale = { min, max, step };
    const shown = Math.min(max, Math.max(min, value));
    /** From 0 at the bottom end to 1 at the top end. */
    const ratio = max > min ? (shown - min) / (max - min) : 0.5;

    const preview = (next: number) => {
        if (next !== value) onPreview(next);
    };

    /** Where on the thumb it was taken: the pointer's distance below the thumb's centre, 0 for a press on the track. */
    const grabRef = useRef(0);
    /** The pointer's last height: a move that is not along the fader sends nothing. */
    const lastYRef = useRef(0);

    const valueUnder = (event: React.PointerEvent<HTMLDivElement>) => {
        const box = event.currentTarget.getBoundingClientRect();
        return faderValueAt(event.clientY - grabRef.current - box.top, box.height, scale);
    };

    return (
        <div
            role="slider"
            tabIndex={0}
            aria-label={label}
            aria-orientation="vertical"
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={shown}
            aria-valuetext={valueText}
            onPointerDown={(event) => {
                if (event.button !== 0) {
                    return;
                }
                event.currentTarget.setPointerCapture(event.pointerId);
                setIsHeld(true);
                lastYRef.current = event.clientY;
                const box = event.currentTarget.getBoundingClientRect();
                const belowCentre = event.clientY - (box.top + THUMB_PX / 2 + (1 - ratio) * (box.height - THUMB_PX));
                // A press on the thumb takes it where it is and changes nothing until it is moved.
                if (Math.abs(belowCentre) <= THUMB_PX / 2) {
                    grabRef.current = belowCentre;
                    return;
                }
                grabRef.current = 0;
                preview(valueUnder(event));
            }}
            onPointerMove={(event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
                    return;
                }
                // A move with no button down means the release was missed (focus went to another window).
                if (event.buttons === 0) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                    return;
                }
                if (event.clientY === lastYRef.current) {
                    return;
                }
                lastYRef.current = event.clientY;
                preview(valueUnder(event));
            }}
            // The one end of a hold: a release, a cancelled pointer and a missed release all come here.
            onLostPointerCapture={() => {
                setIsHeld(false);
                onCommit();
            }}
            onKeyDown={(event) => {
                if (event.altKey || event.ctrlKey || event.metaKey) {
                    return;
                }
                const next = faderKeyValue(event.key, event.shiftKey, shown, scale);
                if (next === null) {
                    return;
                }
                event.preventDefault();
                preview(next);
            }}
            onKeyUp={onCommit}
            onBlur={onCommit}
            // touch-pan-x: a sideways swipe still scrolls a strip of faders that is wider than its place.
            className="relative w-6 flex-1 cursor-pointer touch-pan-x select-none rounded-full"
        >
            <span aria-hidden className="absolute inset-y-0 left-2.5 w-1 overflow-hidden rounded-full bg-[var(--st-track)]">
                {/* The lower half of the track, scaled from the middle: down for a value under the middle, turned up for one over it. */}
                <span
                    className={`absolute inset-x-0 bottom-0 top-1/2 origin-top bg-[var(--st-accent)]${glide ? ' st-t-move transition-transform' : ''}`}
                    style={{ transform: `scaleY(${(0.5 - ratio) * 2})` }}
                />
            </span>
            <span
                aria-hidden
                className={`absolute left-1 h-4 w-4${glide ? ' st-t-move transition-[bottom]' : ''}`}
                style={{ bottom: `calc(${ratio} * (100% - ${THUMB_PX}px))` }}
            >
                <span
                    className="st-t-fast block h-full w-full rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.14),0_1px_3px_rgba(0,0,0,0.35)] transition-transform"
                    style={{ transform: isHeld ? 'scale(1.15)' : undefined }}
                />
            </span>
        </div>
    );
};

export default Fader;
