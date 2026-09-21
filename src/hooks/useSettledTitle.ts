import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
    fitTitle,
    fitTitleToWidth,
    readTitleMetrics,
    titleFitIsPredictable,
    titleFitNeedsCorrection,
    type TitleMetrics,
} from '../utils/fitSettledTitle';
import { sharedTitleFitCache, titleFitCacheKey, type TitleFitCache } from '../utils/settledTitleCache';
import { useFontsEpoch } from './useFontsEpoch';
import { useViewportSettle } from './useViewportSettle';

// src/hooks/useSettledTitle.ts — fit a title to the box it is heading for, before it gets there.

export type TitleFitter = (node: HTMLElement, text: string, metrics: TitleMetrics) => string;

// A null fitter keeps the original CSS-only behavior; probes can compare strategies on the real wall.
const defaultFitter: TitleFitter = (_node, text, metrics) => fitTitleToWidth(text, metrics);
export const TitleFitterContext = createContext<TitleFitter | null>(defaultFitter);

// Shared so a poster that pans back into view reuses its earlier measurement. A probe measuring
// cache misses provides its own instance so results cannot leak between trials.
export const TitleFitCacheContext = createContext<TitleFitCache>(sharedTitleFitCache);

type Options = {
    /** Width the box is heading for, in layout pixels; null when it cannot be predicted. */
    measureWidth?: (node: HTMLElement) => number | null;
    /**
     * Replaces the computed-style read entirely. `epoch` changes whenever a loaded face or a
     * settled resize could have moved the typography, so a caller may cache against it and hand
     * back metrics without touching the DOM - which is what keeps a wall of posters mounting in one
     * commit from forcing a style recalc per card.
     */
    readMetrics?: (node: HTMLElement, epoch: string) => TitleMetrics | null;
};

type Fit = {
    source: string;
    key: string;
    value: string;
    metrics: TitleMetrics;
    /** False where the model is known to diverge, which sends this straight to the browser. */
    predictable: boolean;
    /** Whether the browser has confirmed this one, or handed back a better answer. */
    checked: boolean;
};

/**
 * The fitted preview of `text`, plus whether it has landed.
 *
 * The fit is computed from the width the box is heading for rather than measured off the box it
 * currently has, which is what lets it be right on the first paint: an expanding card knows its
 * target rect before the spring starts, and the measurement is arithmetic over font metrics, so
 * nothing has to be laid out first. The browser still gets the last word - see the second effect -
 * it just no longer has to be asked once per candidate.
 */
export function useSettledTitle(text: string, expanded: boolean, options?: Options) {
    const { measureWidth, readMetrics } = options ?? {};
    const fitter = useContext(TitleFitterContext);
    const cache = useContext(TitleFitCacheContext);
    const ref = useRef<HTMLElement>(null);
    const [fit, setFit] = useState<Fit | null>(null);
    const fontsEpoch = useFontsEpoch();
    const viewport = useViewportSettle();

    // Before paint, so the untruncated title is never the thing on screen. `expanded` is a
    // dependency because it changes the type size this is measured against, and the two epochs
    // because a loaded face or a settled window resize move the metrics under an unchanged box.
    useLayoutEffect(() => {
        const node = ref.current;
        if (!node || !fitter) return;
        const metrics = readMetrics
            ? readMetrics(node, `${fontsEpoch}|${viewport.epoch}`)
            : readTitleMetrics(node, measureWidth?.(node) ?? null);
        if (!metrics) {
            setFit(null);
            return;
        }
        const key = titleFitCacheKey(text, metrics);
        const cached = cache.get(key);
        const value = cached ?? fitter(node, text, metrics);
        if (cached === undefined) cache.set(key, value);
        // A cached answer was already confirmed when it was first measured, by whichever poster
        // asked for it; only a fresh one owes a read.
        setFit({
            source: text, key, value, metrics,
            predictable: titleFitIsPredictable(text, metrics),
            checked: cached !== undefined,
        });
    }, [text, expanded, fitter, cache, measureWidth, readMetrics, fontsEpoch, viewport.epoch]);

    // One read back, against the settled rule that drops the CSS clamp: a prediction that came out
    // a line long would bleed through the padding, and one that came out short cut the title
    // earlier than it had to. Either way the browser's own binary search settles it, and the
    // corrected answer goes into the cache so no other poster repeats the work.
    //
    // A read cannot catch every difference - a cut a grapheme or two short still occupies three
    // lines - so a fit the model cannot predict skips the read and goes straight to the browser.
    useEffect(() => {
        const node = ref.current;
        if (!node || !fitter || !fit || fit.checked || fit.source !== text || viewport.resizing) return;
        const confirm = (value: string) => setFit(current => (
            current === fit ? { ...current, value, checked: true } : current
        ));
        if (fit.predictable && !titleFitNeedsCorrection(node, text, fit.value)) {
            confirm(fit.value);
            return;
        }
        const corrected = fitTitle(node, text, { width: `${fit.metrics.width}px` });
        cache.set(fit.key, corrected);
        confirm(corrected);
    }, [cache, fit, fitter, text, viewport.resizing]);

    return {
        ref,
        value: fit?.source === text ? fit.value : text,
        // A drag-resize is deliberately not settled: the clamp goes back on while the previous
        // preview is still showing, so a fit measured against the old type size cannot overflow.
        settled: fit?.source === text && !viewport.resizing,
    };
}
