import { useMotionValueEvent, type MotionValue } from 'framer-motion';
import { useCallback, useLayoutEffect, useRef } from 'react';
import { formatTime } from '../../../utils/appPlaybackHelpers';

// src/components/app/lattice/LatticeChromeTime.tsx
// The `elapsed / total` readout that sits in the transport row instead of beside the seek bar.

// Writes the elapsed second straight to the DOM, so following playback never re-renders the wall.
export default function LatticeChromeTime({ currentTime, duration }: { currentTime: MotionValue<number>; duration: number }) {
    const elapsedRef = useRef<HTMLSpanElement>(null);
    const lastSecondRef = useRef<number | null>(null);

    const write = useCallback((value: number) => {
        const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
        const clamped = duration > 0 ? Math.min(safe, duration) : safe;
        const second = Math.floor(clamped);
        if (!elapsedRef.current || lastSecondRef.current === second) return;
        lastSecondRef.current = second;
        elapsedRef.current.textContent = formatTime(clamped);
    }, [duration]);

    useLayoutEffect(() => {
        lastSecondRef.current = null;
        write(currentTime.get());
    }, [currentTime, write]);

    useMotionValueEvent(currentTime, 'change', write);

    return (
        <span className="lattice-chrome-time">
            <span ref={elapsedRef}>00:00</span> / {formatTime(duration)}
        </span>
    );
}
