import { useEffect } from 'react';

// src/hooks/useCursorAutoHide.ts
// Hides the mouse cursor after a period of inactivity when enabled.
const CURSOR_HIDDEN_CLASS = 'cursor-auto-hidden';

export function useCursorAutoHide(enabled: boolean, delay = 1200) {
    useEffect(() => {
        const root = document.documentElement;
        const reveal = () => root.classList.remove(CURSOR_HIDDEN_CLASS);
        if (!enabled) {
            reveal();
            return;
        }

        let timerId: number | undefined;
        let rafId: number | undefined;
        let isThrottled = false;

        const bump = () => {
            window.clearTimeout(timerId);
            reveal();
            timerId = window.setTimeout(() => {
                root.classList.add(CURSOR_HIDDEN_CLASS);
            }, delay);
        };
        bump();

        const handleMouseMove = () => {
            if (isThrottled) return;
            isThrottled = true;
            rafId = requestAnimationFrame(() => {
                bump();
                isThrottled = false;
            });
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mousedown', bump);
        return () => {
            window.clearTimeout(timerId);
            if (rafId !== undefined) cancelAnimationFrame(rafId);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mousedown', bump);
            reveal();
        };
    }, [enabled, delay]);
}
