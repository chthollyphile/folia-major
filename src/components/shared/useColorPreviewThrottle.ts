import { useEffect, useRef } from 'react';

// src/components/shared/useColorPreviewThrottle.ts
// Colour dragging is continuous; this keeps the picker fluid while limiting what the drag writes
// (store persistence, re-renders of whatever shows the colour) to a modest preview cadence, then
// flushes the final sampled colour.

const PREVIEW_INTERVAL_MS = 60;

export const useColorPreviewThrottle = (onColorChange: (color: string) => void) => {
    const pendingColorRef = useRef<string | null>(null);
    const colorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const colorHandlerRef = useRef(onColorChange);
    colorHandlerRef.current = onColorChange;

    const flushColor = () => {
        if (colorTimerRef.current !== null) clearTimeout(colorTimerRef.current);
        colorTimerRef.current = null;
        const pending = pendingColorRef.current;
        pendingColorRef.current = null;
        if (pending) colorHandlerRef.current(pending);
    };
    const previewColor = (nextColor: string) => {
        pendingColorRef.current = nextColor;
        if (colorTimerRef.current !== null) return;
        colorTimerRef.current = setTimeout(flushColor, PREVIEW_INTERVAL_MS);
    };
    useEffect(() => () => flushColor(), []);

    return { previewColor, flushColor };
};
