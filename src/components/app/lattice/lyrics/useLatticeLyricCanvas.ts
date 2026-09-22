import { useEffect, useRef, useState, type RefObject } from 'react';
import { createLatticeLyricRuntime } from './createLatticeLyricRuntime';
import { startLatticeLyricSession } from './latticeLyricSession';
import type { LatticeLyricInput, LatticeLyricRuntime } from './types';
import { resolveThemeFontStack, resolveThemeTranslationFontStack, resolveThemeFontWeight } from '../../../../utils/fontStacks';

// src/components/app/lattice/lyrics/useLatticeLyricCanvas.ts
// How long the content box must hold still before the renderer is rebuilt at the new size.
const RESIZE_SETTLE_MS = 120;
const RUNTIME_REUSE_MS = 2000;
type ParkedRuntime = { runtime: LatticeLyricRuntime; timer: ReturnType<typeof setTimeout> };
const parkedRuntimes = new WeakMap<object, ParkedRuntime>();

/** Keeps one stopped runtime per playback clock so a song change can move it to the next card. */
const parkRuntime = (clock: object, runtime: LatticeLyricRuntime) => {
    runtime.setVisible(false);
    const previous = parkedRuntimes.get(clock);
    if (previous) {
        clearTimeout(previous.timer);
        previous.runtime.destroy();
    }
    const parked: ParkedRuntime = { runtime, timer: setTimeout(() => {
        if (parkedRuntimes.get(clock) === parked) parkedRuntimes.delete(clock);
        runtime.destroy();
    }, RUNTIME_REUSE_MS) };
    parkedRuntimes.set(clock, parked);
};

const takeParkedRuntime = (clock: object) => {
    const parked = parkedRuntimes.get(clock);
    if (!parked) return null;
    clearTimeout(parked.timer);
    parkedRuntimes.delete(clock);
    return parked.runtime;
};

/**
 * Observes the local content box (not transformed screen bounds) and owns all external subscriptions.
 *
 * `pixelScale` is the wall's world-to-device ratio - the camera's scale times the display density -
 * and is what the buffer is sized from, because the content box this observes is in world units and
 * the camera shrinks it on the way to the screen.
 */
export function useLatticeLyricCanvas(hostRef: RefObject<HTMLDivElement | null>,
    input: LatticeLyricInput | null, pixelScale: number) {
    const runtimeRef = useRef<LatticeLyricRuntime | null>(null);
    const latest = useRef(input); latest.current = input;
    const density = useRef(pixelScale); density.current = pixelScale;
    // The host's last observed content box, kept outside the session effect so a density change
    // can resize the live runtime without restarting the session.
    const box = useRef({ width: 0, height: 0 });
    const [ready, setReady] = useState(false);
    const [failedKey, setFailedKey] = useState<string | null>(null);
    const songKey = input?.songKey;
    const enabled = Boolean(input?.lines.some(line => line.fullText.trim()) && failedKey !== songKey);

    useEffect(() => {
        const host = hostRef.current, initial = latest.current;
        setReady(false);
        if (!host || !initial || !enabled) return;
        let active = true, intersecting = false;
        box.current = { width: host.clientWidth, height: host.clientHeight };
        let pendingResize: ReturnType<typeof setTimeout> | null = null;
        const visible = () => intersecting && !document.hidden;
        const onVisibility = () => runtimeRef.current?.setVisible(visible());
        const onFailure = (error: unknown) => {
            if (!active) return;
            console.warn('[Lattice lyrics] Falling back to the song title', error);
            runtimeRef.current?.destroy(); runtimeRef.current = null;
            setReady(false); setFailedKey(initial.songKey);
        };
        const session = startLatticeLyricSession(signal => {
            const parked = takeParkedRuntime(initial.currentTime);
            return parked ?? createLatticeLyricRuntime(host, initial, density.current, signal, onFailure);
        }, runtime => {
            runtimeRef.current = runtime;
            runtime.attach(host);
            runtime.setErrorHandler(onFailure);
            if (latest.current) runtime.update(latest.current);
            runtime.setVisible(visible()); runtime.resize(box.current.width, box.current.height, density.current);
            setReady(true);
        }, onFailure);
        // A runtime resize reallocates the renderer, re-measures the typography and re-rasterizes
        // every line. Expansion springs the card's width and height, so this box changes on every
        // frame of it; applying each one would rebuild the whole scene 60 times a second. CSS keeps
        // the canvas stretched at its old resolution until the box holds still.
        const resize = new ResizeObserver(entries => {
            const rect = entries[0]?.contentRect;
            if (!rect || (rect.width === box.current.width && rect.height === box.current.height)) return;
            box.current = { width: rect.width, height: rect.height };
            if (pendingResize !== null) clearTimeout(pendingResize);
            pendingResize = setTimeout(() => {
                pendingResize = null;
                runtimeRef.current?.resize(box.current.width, box.current.height, density.current);
            }, RESIZE_SETTLE_MS);
        });
        resize.observe(host);
        const intersection = new IntersectionObserver(entries => {
            intersecting = entries[0]?.isIntersecting ?? false; onVisibility();
        });
        intersection.observe(host);
        document.addEventListener('visibilitychange', onVisibility);
        const onContextLost = (event: Event) => { event.preventDefault(); onFailure(new Error('WebGL context lost')); };
        host.addEventListener('webglcontextlost', onContextLost, true);
        return () => {
            active = false; resize.disconnect(); intersection.disconnect();
            if (pendingResize !== null) clearTimeout(pendingResize);
            document.removeEventListener('visibilitychange', onVisibility);
            host.removeEventListener('webglcontextlost', onContextLost, true);
            const released = session.release();
            if (released && runtimeRef.current === released) parkRuntime(initial.currentTime, released);
            else released?.destroy();
            runtimeRef.current = null;
        };
    }, [hostRef, songKey, enabled]);

    useEffect(() => { if (input) runtimeRef.current?.update(input); }, [input]);
    // Dragging the window onto a display of another density, or the camera stepping to another
    // scale at a width breakpoint: same box, different pixel budget. Neither reaches the
    // ResizeObserver above - the camera is a transform on the world, so the content box this hook
    // observes is unchanged in both cases - which is why the scale is a dependency of its own.
    useEffect(() => { runtimeRef.current?.resize(box.current.width, box.current.height, pixelScale); }, [pixelScale]);
    useEffect(() => {
        if (!input || !document.fonts) return;
        const primary = `${resolveThemeFontWeight(input.theme, 600)} 36px ${resolveThemeFontStack(input.theme)}`;
        const subtitle = input.subtitleTheme ?? input.theme;
        const translation = `${resolveThemeFontWeight(subtitle, 500)} 18px ${resolveThemeTranslationFontStack(subtitle)}`;
        // Trigger custom-face loading even when the full visualizer is not mounted.
        void Promise.all([document.fonts.load(primary, '国Agyp'), document.fonts.load(translation, '国Agyp')]).catch(() => undefined);
    }, [input?.theme, input?.subtitleTheme]);
    return ready && enabled;
}
