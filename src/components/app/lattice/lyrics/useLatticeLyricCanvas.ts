import { useEffect, useRef, useState, type RefObject } from 'react';
import { createLatticeLyricRuntime } from './createLatticeLyricRuntime';
import { startLatticeLyricSession } from './latticeLyricSession';
import type { LatticeLyricInput, LatticeLyricRuntime } from './types';
import { resolveThemeFontStack, resolveThemeTranslationFontStack, resolveThemeFontWeight } from '../../../../utils/fontStacks';

// src/components/app/lattice/lyrics/useLatticeLyricCanvas.ts
// How long the content box must hold still before the renderer is rebuilt at the new size.
const RESIZE_SETTLE_MS = 120;

/** Observes the local content box (not transformed screen bounds) and owns all external subscriptions. */
export function useLatticeLyricCanvas(hostRef: RefObject<HTMLDivElement | null>, input: LatticeLyricInput | null) {
    const runtimeRef = useRef<LatticeLyricRuntime | null>(null);
    const latest = useRef(input); latest.current = input;
    const [ready, setReady] = useState(false);
    const [failedKey, setFailedKey] = useState<string | null>(null);
    const songKey = input?.songKey;
    const enabled = Boolean(input?.lines.some(line => line.fullText.trim()) && failedKey !== songKey);

    useEffect(() => {
        const host = hostRef.current, initial = latest.current;
        setReady(false);
        if (!host || !initial || !enabled) return;
        let active = true, intersecting = false, width = host.clientWidth, height = host.clientHeight;
        let pendingResize: ReturnType<typeof setTimeout> | null = null;
        const visible = () => intersecting && !document.hidden;
        const onVisibility = () => runtimeRef.current?.setVisible(visible());
        const onFailure = (error: unknown) => {
            if (!active) return;
            console.warn('[Lattice lyrics] Falling back to the song title', error);
            runtimeRef.current?.destroy(); runtimeRef.current = null;
            setReady(false); setFailedKey(initial.songKey);
        };
        const session = startLatticeLyricSession(signal => createLatticeLyricRuntime(host, initial, signal, onFailure), runtime => {
            runtimeRef.current = runtime;
            if (latest.current) runtime.update(latest.current);
            runtime.setVisible(visible()); runtime.resize(width, height);
            setReady(true);
        }, onFailure);
        // A runtime resize reallocates the renderer, re-measures the typography and re-rasterizes
        // every line. Expansion springs the card's width and height, so this box changes on every
        // frame of it; applying each one would rebuild the whole scene 60 times a second. CSS keeps
        // the canvas stretched at its old resolution until the box holds still.
        const resize = new ResizeObserver(entries => {
            const box = entries[0]?.contentRect;
            if (!box || (box.width === width && box.height === height)) return;
            width = box.width; height = box.height;
            if (pendingResize !== null) clearTimeout(pendingResize);
            pendingResize = setTimeout(() => {
                pendingResize = null;
                runtimeRef.current?.resize(width, height);
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
            session.destroy(); runtimeRef.current = null;
        };
    }, [hostRef, songKey, enabled]);

    useEffect(() => { if (input) runtimeRef.current?.update(input); }, [input]);
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
