import { useEffect, useRef, useState } from 'react';

// src/hooks/useIdleCursorHide.ts
// An idle clock of the cursor's own: hides the pointer after a spell without mouse movement, on
// its own, while the player chrome (progress bar, buttons) stays visible. This is the opposite of
// `autoHideCursorWithPlayerChrome`, which ties the cursor to the chrome's auto-hide; that one keeps
// them together, this one lets the cursor go away alone. The chrome's own clock (`usePlayerChromeAutoHide`)
// still owns whether the controls hide, and the two hide the cursor independently.

const CURSOR_IDLE_HIDE_MS = 3000;

export const useIdleCursorHide = (enabled: boolean): boolean => {
    const [cursorHidden, setCursorHidden] = useState(false);
    const timeoutRef = useRef<number | undefined>(undefined);
    const rafRef = useRef<number | undefined>(undefined);

    useEffect(() => {
        if (!enabled) {
            setCursorHidden(false);
            return;
        }

        let throttled = false;
        let pointerHeld = false;

        const clearTimer = () => {
            window.clearTimeout(timeoutRef.current);
            timeoutRef.current = undefined;
        };

        const schedule = (delay: number) => {
            clearTimer();
            if (pointerHeld) return;
            timeoutRef.current = window.setTimeout(() => {
                timeoutRef.current = undefined;
                setCursorHidden(true);
            }, delay);
        };

        const revealAndRestart = () => {
            setCursorHidden(false);
            schedule(CURSOR_IDLE_HIDE_MS);
        };

        const handleMouseMove = () => {
            if (throttled) return;
            throttled = true;
            rafRef.current = requestAnimationFrame(() => {
                revealAndRestart();
                throttled = false;
            });
        };

        const handlePointerDown = () => {
            pointerHeld = true;
            clearTimer();
            setCursorHidden(false);
        };

        const handlePointerUp = () => {
            pointerHeld = false;
            revealAndRestart();
        };

        revealAndRestart();
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('pointerdown', handlePointerDown);
        window.addEventListener('pointerup', handlePointerUp);
        window.addEventListener('pointercancel', handlePointerUp);
        window.addEventListener('wheel', revealAndRestart, { passive: true });

        return () => {
            clearTimer();
            if (rafRef.current !== undefined) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = undefined;
            }
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('pointerdown', handlePointerDown);
            window.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('pointercancel', handlePointerUp);
            window.removeEventListener('wheel', revealAndRestart);
        };
    }, [enabled]);

    return cursorHidden;
};
