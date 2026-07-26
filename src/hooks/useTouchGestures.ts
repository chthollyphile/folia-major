import { useEffect, useRef, type RefObject } from 'react';

// Touch gesture controller for the main player stage (lyrics view).
//
// Implements three interactions on the primary playback view:
//   - Double tap  -> toggle play / pause
//   - Horizontal swipe (quick flick) -> previous / next track
//   - Press-and-drag (pan, held longer) -> seek by mapping horizontal offset to playback time
//
// The hook only needs a single touch point; multi-touch gestures are ignored so they
// don't fight with pinch-zoom or other multi-finger interactions elsewhere.

export type TouchGestureHandlers = {
    /** Element that represents the main view. Touch listeners are attached here. */
    targetRef: RefObject<HTMLDivElement | null>;
    /** When false, listeners are not attached (e.g. not on the player view). */
    enabled?: boolean;
    onTogglePlay: () => void;
    onNext: () => void;
    onPrev: () => void;
    /** Committed seek (e.g. on touchend). */
    onSeek?: (time: number) => void;
    /** Live seek preview while panning (should NOT force playback to start). */
    onSeekPreview?: (time: number) => void;
    /** Returns the current track duration in seconds (0 if unknown). */
    getDuration: () => number;
    /** Returns the current playback position in seconds. */
    getCurrentTime: () => number;
};

const DOUBLE_TAP_MS = 300;
const SWIPE_MIN_DISTANCE = 60;
const SWIPE_MAX_DURATION = 280;
const PAN_HOLD_THRESHOLD_MS = 220;
const TAP_MOVE_TOLERANCE = 14;
const TAP_MAX_DURATION = 250;
const SWIPE_VERTICAL_DOMINANCE = 1.4;

export function useTouchGestures({
    targetRef,
    enabled = true,
    onTogglePlay,
    onNext,
    onPrev,
    onSeek,
    onSeekPreview,
    getDuration,
    getCurrentTime,
}: TouchGestureHandlers): void {
    const lastTapTimeRef = useRef(0);
    const activeIdRef = useRef<number | null>(null);
    const startXRef = useRef(0);
    const startYRef = useRef(0);
    const startTRef = useRef(0);
    const startCurrentTimeRef = useRef(0);
    const gestureRef = useRef<'none' | 'pan'>('none');

    // Keep the latest callbacks in a ref so the native listeners never need rebinding.
    const cbRef = useRef({ onTogglePlay, onNext, onPrev, onSeek, onSeekPreview, getDuration, getCurrentTime });
    cbRef.current = { onTogglePlay, onNext, onPrev, onSeek, onSeekPreview, getDuration, getCurrentTime };

    useEffect(() => {
        const target = targetRef.current;
        if (!target || !enabled) {
            return;
        }

        // Ignore gestures that start on interactive controls (buttons, links, sliders, ...)
        // so native click / drag behaviour is preserved.
        const isInteractive = (el: EventTarget | null): boolean => {
            if (!(el instanceof Element)) {
                return false;
            }
            return !!el.closest('button, a, input, select, textarea, [role="slider"], [data-gesture-skip]');
        };

        const findTouch = (list: TouchList, id: number): Touch | null => {
            for (let i = 0; i < list.length; i++) {
                if (list[i].identifier === id) {
                    return list[i];
                }
            }
            return null;
        };

        const computePanTime = (dx: number): number => {
            const duration = cbRef.current.getDuration();
            const width = target.clientWidth || window.innerWidth;
            if (!duration || !width) {
                return cbRef.current.getCurrentTime();
            }
            const delta = (dx / width) * duration;
            return Math.min(duration, Math.max(0, startCurrentTimeRef.current + delta));
        };

        const onTouchStart = (e: TouchEvent) => {
            if (e.touches.length !== 1) {
                // More than one finger: abandon any in-progress single-finger gesture.
                activeIdRef.current = null;
                gestureRef.current = 'none';
                return;
            }
            if (isInteractive(e.target)) {
                return;
            }
            const touch = e.touches[0];
            activeIdRef.current = touch.identifier;
            startXRef.current = touch.clientX;
            startYRef.current = touch.clientY;
            startTRef.current = Date.now();
            startCurrentTimeRef.current = cbRef.current.getCurrentTime();
            gestureRef.current = 'none';
        };

        const onTouchMove = (e: TouchEvent) => {
            const id = activeIdRef.current;
            if (id === null) {
                return;
            }
            const touch = findTouch(e.touches, id);
            if (!touch) {
                return;
            }

            const dx = touch.clientX - startXRef.current;
            const dy = touch.clientY - startYRef.current;
            const dt = Date.now() - startTRef.current;

            if (gestureRef.current !== 'pan') {
                const horizontal = Math.abs(dx) > Math.abs(dy);
                // Promote to a seek-pan once the user has held and dragged horizontally.
                // A quicker flick (shorter hold) is handled as a swipe at touchend instead.
                if (dt >= PAN_HOLD_THRESHOLD_MS && horizontal && Math.abs(dx) > TAP_MOVE_TOLERANCE) {
                    gestureRef.current = 'pan';
                }
            }

            if (gestureRef.current === 'pan' && Math.abs(dx) > Math.abs(dy)) {
                e.preventDefault();
                cbRef.current.onSeekPreview?.(computePanTime(dx));
            }
        };

        const onTouchEnd = (e: TouchEvent) => {
            const id = activeIdRef.current;
            if (id === null) {
                return;
            }
            const touch = findTouch(e.changedTouches, id);
            if (!touch) {
                activeIdRef.current = null;
                gestureRef.current = 'none';
                return;
            }

            const dx = touch.clientX - startXRef.current;
            const dy = touch.clientY - startYRef.current;
            const dt = Date.now() - startTRef.current;
            const absDx = Math.abs(dx);
            const absDy = Math.abs(dy);

            if (gestureRef.current === 'pan') {
                if (absDx > absDy) {
                    e.preventDefault();
                    cbRef.current.onSeek?.(computePanTime(dx));
                }
                activeIdRef.current = null;
                gestureRef.current = 'none';
                return;
            }

            // Quick horizontal flick -> track switch.
            if (dt <= SWIPE_MAX_DURATION && absDx >= SWIPE_MIN_DISTANCE && absDx > absDy * SWIPE_VERTICAL_DOMINANCE) {
                e.preventDefault();
                if (dx < 0) {
                    cbRef.current.onNext();
                } else {
                    cbRef.current.onPrev();
                }
                activeIdRef.current = null;
                return;
            }

            // Tap (within tolerance) -> double-tap detection for play / pause.
            if (absDx <= TAP_MOVE_TOLERANCE && absDy <= TAP_MOVE_TOLERANCE && dt <= TAP_MAX_DURATION) {
                const now = Date.now();
                if (now - lastTapTimeRef.current <= DOUBLE_TAP_MS) {
                    lastTapTimeRef.current = 0;
                    e.preventDefault();
                    cbRef.current.onTogglePlay();
                } else {
                    lastTapTimeRef.current = now;
                }
                activeIdRef.current = null;
                return;
            }

            activeIdRef.current = null;
        };

        const onTouchCancel = () => {
            activeIdRef.current = null;
            gestureRef.current = 'none';
        };

        target.addEventListener('touchstart', onTouchStart, { passive: true });
        target.addEventListener('touchmove', onTouchMove, { passive: false });
        target.addEventListener('touchend', onTouchEnd, { passive: false });
        target.addEventListener('touchcancel', onTouchCancel, { passive: true });

        return () => {
            target.removeEventListener('touchstart', onTouchStart);
            target.removeEventListener('touchmove', onTouchMove);
            target.removeEventListener('touchend', onTouchEnd);
            target.removeEventListener('touchcancel', onTouchCancel);
        };
    }, [targetRef, enabled]);
}
