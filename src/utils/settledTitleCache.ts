import { TITLE_MAX_LINES, type TitleMetrics } from './fitSettledTitle';

// src/utils/settledTitleCache.ts — wall-level reuse of settled title measurements.

export type TitleFitCache = {
    get: (key: string) => string | undefined;
    set: (key: string, value: string) => void;
};

// A poster that pans off screen unmounts its observers, so a cache owned by the component is thrown
// away exactly when the user is most likely to pan back onto it. The bound is generous next to a
// mounted wall (~45 posters) and small next to a long queue: a few hundred titles at one or two
// widths stay resident, while a full sweep of a 1000-song queue ages out oldest-first instead of
// growing without limit.
const DEFAULT_LIMIT = 512;

/** Bounded, recency-ordered store. Eviction reads Map insertion order, so hits re-insert. */
export function createTitleFitCache(limit = DEFAULT_LIMIT): TitleFitCache {
    const entries = new Map<string, string>();
    return {
        get: key => {
            const value = entries.get(key);
            if (value !== undefined) {
                entries.delete(key);
                entries.set(key, value);
            }
            return value;
        },
        set: (key, value) => {
            entries.delete(key);
            entries.set(key, value);
            while (entries.size > limit) {
                const oldest = entries.keys().next();
                if (oldest.done) break;
                entries.delete(oldest.value);
            }
        },
    };
}

export const sharedTitleFitCache = createTitleFitCache();

// Bumped when a font finishes loading. Entries measured against the previous faces are not cleared,
// they simply stop being addressable: every later key carries the new epoch. That ordering holds
// without coordinating with the hook's own `loadingdone` handler, because this listener is
// registered at module evaluation and therefore runs before any handler a component effect adds.
let fontsEpoch = 0;
if (typeof document !== 'undefined' && document.fonts) {
    document.fonts.addEventListener('loadingdone', () => { fontsEpoch += 1; });
    void document.fonts.ready.then(() => { fontsEpoch += 1; }).catch(() => undefined);
}

/**
 * Identifies a fitted result across posters: same text, same column and same measured typography
 * means the same answer, whichever card asks for it.
 *
 * The metrics are what the fit is computed from, so they are the whole key - the earlier version
 * listed fourteen computed properties because it fitted by laying text out in the document, where
 * anything in the cascade could move the result. The text goes last so a title containing the
 * separator cannot shift the fixed-arity prefix.
 */
export function titleFitCacheKey(text: string, metrics: TitleMetrics): string {
    return [fontsEpoch, metrics.width, metrics.lineHeight, metrics.letterSpacing, metrics.maxLines ?? TITLE_MAX_LINES, metrics.font, text].join('|');
}
