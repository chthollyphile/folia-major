import { useCallback, useEffect, useRef, useState } from 'react';

// src/components/app/lattice/useLatticeExpansionSettled.ts
// Ceiling for the expansion spring. Framer Motion drops `onAnimationComplete` when an animation is
// interrupted, so the timer guarantees the gated content still appears if the rect moves mid-flight.
const SETTLE_FALLBACK_MS = 1000;

/**
 * Whether an expanded poster has stopped growing. Content that is expensive to mount and expensive
 * to re-lay-out - the Pixi lyric scene - waits on this rather than on `expanded`, so neither its
 * cold start nor its size-driven rebuild lands inside the expansion animation.
 */
export function useLatticeExpansionSettled(expanded: boolean, immediate: boolean) {
    const [settled, setSettled] = useState(false);
    const expandedRef = useRef(expanded);
    expandedRef.current = expanded;

    useEffect(() => {
        if (!expanded) {
            setSettled(false);
            return;
        }
        if (immediate) {
            setSettled(true);
            return;
        }
        const timer = setTimeout(() => setSettled(true), SETTLE_FALLBACK_MS);
        return () => clearTimeout(timer);
    }, [expanded, immediate]);

    // A collapsed poster animates too - entrance, camera reflow - so completions outside the open
    // state must not arm the gate before the next expansion has even started.
    const onAnimationComplete = useCallback(() => {
        if (expandedRef.current) setSettled(true);
    }, []);

    return [settled, onAnimationComplete] as const;
}
