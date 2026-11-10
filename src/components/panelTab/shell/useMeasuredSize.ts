import { useLayoutEffect, useState, type RefObject } from 'react';

// src/components/panelTab/shell/useMeasuredSize.ts
// The laid-out size of an element, kept up to date. The panel sizes itself from what its open tab
// needs, so it reads that from the document instead of holding a table of heights.

type Size = { width: number; height: number };

/**
 * The element's size in layout pixels (a transform on it or around it does not change the answer).
 * Read before the first paint and again when `dep` changes, which is how the caller says that
 * another element sits in the ref now; a ResizeObserver follows every later change. The state only
 * changes when a number does.
 */
export const useMeasuredSize = (ref: RefObject<HTMLElement | null>, dep?: unknown): Size => {
    const [size, setSize] = useState<Size>({ width: 0, height: 0 });

    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) {
            return undefined;
        }

        const read = () => {
            const width = element.offsetWidth;
            const height = element.offsetHeight;
            setSize(previous => (previous.width === width && previous.height === height ? previous : { width, height }));
        };

        read();
        const observer = new ResizeObserver(read);
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref, dep]);

    return size;
};
