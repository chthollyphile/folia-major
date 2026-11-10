import { useEffect, useState, type RefObject } from 'react';

// src/components/modal/settings/kit/usePicturesInView.ts
// Which pictures of a grid are on screen, for PictureGrid and PictureChecks: a picture that moves
// runs only while it can be seen.

const NONE: ReadonlySet<string> = new Set();

/**
 * The values of the tiles under `rootRef` (each marked `data-value`) that are on screen at this
 * moment. The browser reports it: it knows the grid's own scroll, every scroll and clip around the
 * grid, and the edge of the window. Where it cannot report, every picture counts as on screen. A
 * picture that is no longer among `values` (the options as one text, one per line) is forgotten.
 */
export const usePicturesInView = (rootRef: RefObject<HTMLElement | null>, values: string): ReadonlySet<string> => {
    const [seen, setSeen] = useState(NONE);

    useEffect(() => {
        const root = rootRef.current;
        if (!root) {
            return undefined;
        }
        const offered = new Set(values.split('\n'));
        if (typeof IntersectionObserver === 'undefined') {
            setSeen(offered);
            return undefined;
        }
        setSeen(before => ([...before].every(tile => offered.has(tile)) ? before : new Set([...before].filter(tile => offered.has(tile)))));
        const observer = new IntersectionObserver((entries) => {
            setSeen((before) => {
                const after = new Set(before);
                for (const entry of entries) {
                    const tile = (entry.target as HTMLElement).dataset.value ?? '';
                    if (entry.isIntersecting) after.add(tile);
                    else after.delete(tile);
                }
                return after;
            });
        });
        root.querySelectorAll('[data-value]').forEach(tile => observer.observe(tile));
        return () => observer.disconnect();
    }, [rootRef, values]);

    return seen;
};
