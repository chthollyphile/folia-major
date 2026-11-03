import { useEffect, useMemo, useRef, useState } from 'react';
import type { MotionValue } from 'framer-motion';
import { mixColors } from '../colorMix';
import { progressSince } from '../../../services/automix/handoffProgress';

// src/components/visualizer/backgrounds/useBlendedColors.ts
// For a background that changes its colours in place rather than as a new copy (its entry has no
// `song`; a second WebGL copy on every song change would hold up the page): the colours it draws,
// blended from the ones on screen over `blendMs` (VisualizerBackgroundRenderProps), the soft focus's
// length where the host plays transitions and 0 where it changes at once. During a blend's song
// hand-off the blend plays along the hand-off instead (`blendProgress`), as long as the blend.

/** The soft focus's own ease out, near enough for colours. */
const easeOut = (t: number) => 1 - (1 - t) ** 3;

const sameColors = (left: readonly string[], right: readonly string[]) => (
    left.length === right.length && left.every((color, index) => color === right[index])
);

/**
 * `colors` as drawn: a change blends from what is drawn to them over `durationMs`; with 0, at once.
 * With `progress`, along it (0..1) from where it stood when the change came, so colours that arrive
 * late in a hand-off still blend in; once it is gone, the rest of a blend runs over `durationMs`.
 */
export const useBlendedColors = (
    colors: readonly string[],
    durationMs: number,
    progress?: MotionValue<number>,
): readonly string[] => {
    const key = colors.join('|');
    // The same array while the colours stay the same, though `colors` is a new one each render.
    const target = useMemo(() => key.split('|'), [key]);
    const [drawn, setDrawn] = useState<readonly string[]>(target);
    // What is on screen now, also partway through a blend, so a new change blends on from there.
    const drawnRef = useRef<readonly string[]>(target);

    useEffect(() => {
        const from = drawnRef.current;
        const show = (next: readonly string[]) => {
            drawnRef.current = next;
            setDrawn(next);
        };
        if (sameColors(from, target)) return undefined;
        if (durationMs <= 0 || from.length !== target.length) {
            show(target);
            return undefined;
        }
        const mixed = (t: number) => (t >= 1 ? target : target.map((to, index) => mixColors(from[index], to, t)));
        const start = progress?.get() ?? 1;
        if (progress && start < 1) {
            // Evenly: the hand-off's progress brings its own curve.
            const follow = (value: number) => show(mixed(progressSince(value, start)));
            return progress.on('change', follow);
        }
        const startedAt = performance.now();
        let frame = 0;
        const step = (now: number) => {
            const t = Math.min(1, (now - startedAt) / durationMs);
            show(mixed(t >= 1 ? 1 : easeOut(t)));
            if (t < 1) frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
        return () => cancelAnimationFrame(frame);
    }, [target, durationMs, progress]);

    return durationMs <= 0 ? target : drawn;
};
