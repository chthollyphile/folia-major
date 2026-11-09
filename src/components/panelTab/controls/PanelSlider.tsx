import React, { useRef, useState } from 'react';

// src/components/panelTab/controls/PanelSlider.tsx
// A slider drawn by the app, for a value that is tried out while the thumb moves and kept when it
// is let go: every move calls onPreview, and letting go (the pointer, a key, or focus leaving)
// calls onCommit, which may come more than once for one hold. The thumb follows the pointer with no delay and grows a little while it is held.
// A press on the thumb that does not move it sends no value.

const THUMB_PX = 16;
/** How far an arrow key moves the thumb. */
const KEY_STEP = 0.05;

type PanelSliderProps = {
    /** From 0 to 1. */
    value: number;
    onPreview: (value: number) => void;
    onCommit: () => void;
    /** The accessible name. */
    label: string;
    /** How the value reads, e.g. "72%". */
    valueText: string;
    /**
     * Out of reach: dimmed, and neither the pointer nor a key moves it. It still takes focus, so a
     * screen reader reaches it and hears it is unavailable.
     */
    disabled?: boolean;
};

const clampUnit = (value: number) => Math.min(1, Math.max(0, value));

export const PanelSlider: React.FC<PanelSliderProps> = ({ value, onPreview, onCommit, label, valueText, disabled = false }) => {
    const trackRef = useRef<HTMLDivElement>(null);
    const [isHeld, setIsHeld] = useState(false);
    const shown = clampUnit(value);
    /** Where on the thumb it was taken: the pointer's distance from the thumb's centre, 0 for a press on the track. */
    const grabRef = useRef(0);
    /** The pointer's last place along the track: a move that is not along it sends nothing. */
    const lastXRef = useRef(0);

    /** The value for a thumb whose centre is at `centreX`, in whole hundredths. */
    const valueAt = (centreX: number) => {
        const rect = trackRef.current!.getBoundingClientRect();
        return Math.round(clampUnit((centreX - rect.left - THUMB_PX / 2) / (rect.width - THUMB_PX)) * 100) / 100;
    };

    const release = () => {
        // Out of reach, only a hold that began before the slider went out of reach still ends with a commit.
        if (disabled && !isHeld) {
            return;
        }
        setIsHeld(false);
        onCommit();
    };

    const handleKeyDown = (event: React.KeyboardEvent) => {
        if (disabled) {
            return;
        }
        // To the next line of the key's grid, so a value between two lines gets back onto a round place.
        const next = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? (Math.floor(shown / KEY_STEP + 1e-6) + 1) * KEY_STEP
            : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? (Math.ceil(shown / KEY_STEP - 1e-6) - 1) * KEY_STEP
                : event.key === 'Home' ? 0
                    : event.key === 'End' ? 1
                        : null;
        if (next === null) {
            return;
        }
        event.preventDefault();
        onPreview(Math.round(clampUnit(next) * 100) / 100);
    };

    return (
        <div
            ref={trackRef}
            role="slider"
            tabIndex={0}
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(shown * 100)}
            aria-valuetext={valueText}
            aria-disabled={disabled || undefined}
            onPointerDown={(event) => {
                if (disabled || event.button !== 0) {
                    return;
                }
                event.currentTarget.setPointerCapture(event.pointerId);
                setIsHeld(true);
                lastXRef.current = event.clientX;
                const rect = event.currentTarget.getBoundingClientRect();
                const fromCentre = event.clientX - (rect.left + THUMB_PX / 2 + shown * (rect.width - THUMB_PX));
                // A press on the thumb takes it where it is and changes nothing until it is moved; a
                // press on the track brings the thumb's centre there.
                if (Math.abs(fromCentre) <= THUMB_PX / 2) {
                    grabRef.current = fromCentre;
                    return;
                }
                grabRef.current = 0;
                onPreview(valueAt(event.clientX));
            }}
            onPointerMove={(event) => {
                // A move with no button down means the release was missed (focus went to another window).
                if (disabled || !isHeld || event.buttons === 0 || event.clientX === lastXRef.current) {
                    return;
                }
                lastXRef.current = event.clientX;
                onPreview(valueAt(event.clientX - grabRef.current));
            }}
            onPointerUp={release}
            onPointerCancel={release}
            onLostPointerCapture={release}
            onKeyDown={handleKeyDown}
            onKeyUp={disabled ? undefined : onCommit}
            onBlur={release}
            className={disabled
                ? 'relative h-6 min-w-0 flex-1 cursor-not-allowed touch-none rounded-full opacity-40'
                : 'relative h-6 min-w-0 flex-1 cursor-pointer touch-none rounded-full'}
        >
            <span className="absolute inset-x-0 top-2.5 h-1 overflow-hidden rounded-full bg-[var(--st-track)]">
                <span className="absolute inset-0 origin-left bg-[var(--st-accent)]" style={{ transform: `scaleX(${shown})` }} />
            </span>
            <span
                className="st-t-fast absolute top-1 h-4 w-4 rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.14),0_1px_3px_rgba(0,0,0,0.35)] transition-transform"
                style={{ left: `calc(${shown} * (100% - ${THUMB_PX}px))`, transform: isHeld ? 'scale(1.15)' : undefined }}
            />
        </div>
    );
};

export default PanelSlider;
