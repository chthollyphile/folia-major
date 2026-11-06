import { createPackRenderer } from './render';
import type { PackFrame, StylePack } from './types';

// One lifecycle for both hosts: capped raster size/FPS, hidden-tab suspension and explicit disposal.
export function mountPackCanvas(canvas: HTMLCanvasElement, getInput: () => { pack: StylePack; frame: PackFrame; fps?: number; animate?: boolean }, onError: (error: unknown) => void) {
    const context = canvas.getContext('2d');
    if (!context) {
        onError(new Error('Canvas 2D unavailable'));
        return { draw: () => {}, capture: () => {}, dispose: () => {} };
    }
    const render = createPackRenderer();
    let raf = 0, last = -Infinity, disposed = false, failed = false, dirty = true;
    const renderNow = () => {
        if (disposed || failed || !canvas.clientWidth || !canvas.clientHeight) return;
        try {
            const input = getInput();
            const ratio = Math.min(window.devicePixelRatio || 1, 2, 1920 / canvas.clientWidth, 1920 / canvas.clientHeight);
            const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
            const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
            if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
            render(context, input.pack, input.frame, width, height);
            dirty = false;
        } catch (error) { failed = true; onError(error); }
    };
    const tick = (now: number) => {
        if (disposed || failed) return;
        try {
            if (!document.hidden) {
                const input = getInput();
                const interval = 1000 / Math.max(1, Math.min(30, input.fps || 30));
                const elapsed = now - last;
                // Keep the schedule's remainder: assigning `last = now` loses frames on 60/120 Hz screens.
                // The same 1 ms tolerance as Folia's frame limiter absorbs RAF timestamp rounding.
                if ((input.animate !== false || dirty) && elapsed >= interval - 1) {
                    renderNow();
                    last = Number.isFinite(last) ? last + Math.max(1, Math.floor((elapsed + 1) / interval)) * interval : now;
                }
            }
        } catch (error) { failed = true; onError(error); }
        raf = requestAnimationFrame(tick);
    };
    // Clock/resize/React updates only invalidate; even a 120 Hz static clock stays behind this gate.
    const draw = () => { dirty = true; };
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    raf = requestAnimationFrame(tick);
    // Capture is reserved for an explicit user export, never a clock or resize callback.
    return { draw, capture: renderNow, dispose: () => { disposed = true; cancelAnimationFrame(raf); observer.disconnect(); } };
}
