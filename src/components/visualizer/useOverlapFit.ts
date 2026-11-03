import { useLayoutEffect, useState, type RefObject } from 'react';

// src/components/visualizer/useOverlapFit.ts
// 「防止文字重叠」把词和行拉开以后，长句可能高过（或宽过）歌词区域而被裁掉。这里在排版后量一次，
// 放不下就把这一句的字号按比例缩小；词距、行距都跟字号成比例，缩小后照样不重叠。

/**
 * The data attribute a style puts on its line container, holding the line's key. The container's
 * layout height must be its content's (no min-height while the fit is on), or a short window would
 * shrink every line to the floor without it ever fitting.
 */
export const OVERLAP_FIT_LINE_ATTRIBUTE = 'data-overlap-fit-line';

/**
 * The attribute a style puts on each row that does not wrap (Partita's chunks), so the widest one is
 * checked against the area's width. Rows that wrap (Classic) need no width check.
 */
export const OVERLAP_FIT_ROW_ATTRIBUTE = 'data-overlap-fit-row';

/** Never shrink a line below this share of its size: past that, clipping reads better than dust. */
const MIN_FIT = 0.5;

/** Shrink a hair more than the ratio, so rounding in the next layout does not leave a pixel over. */
const FIT_SLACK = 0.98;

/**
 * The factor a style multiplies its main font size by so the line with `lineKey` fits the area. 1
 * when `enabled` is off, and again for every new line until it has been measured. Measures in a
 * layout effect, before paint, so a line that needs shrinking is never shown at full size; it only
 * re-measures when the line, the factor or something in `layoutKeys` changes.
 */
export const useOverlapFit = (
    enabled: boolean,
    lineKey: string | number | null | undefined,
    areaRef: RefObject<HTMLElement | null>,
    layoutKeys: ReadonlyArray<unknown>,
): number => {
    const [fit, setFit] = useState<{ key: typeof lineKey; scale: number }>({ key: null, scale: 1 });
    const scale = enabled && fit.key === lineKey ? fit.scale : 1;

    useLayoutEffect(() => {
        if (!enabled || lineKey === null || lineKey === undefined) return;
        const area = areaRef.current;
        // The outgoing line is still in the area while it exits, so find this line by its key.
        const line = area?.querySelector<HTMLElement>(`[${OVERLAP_FIT_LINE_ATTRIBUTE}="${String(lineKey)}"]`);
        if (!area || !line) return;

        const style = getComputedStyle(area);
        const availableHeight = area.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
        const availableWidth = area.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        // Layout sizes only: bounding boxes and scrollWidth would take in the entry animation's
        // transforms and the px offsets, which shrinking the type cannot take back.
        const rows = line.querySelectorAll<HTMLElement>(`[${OVERLAP_FIT_ROW_ATTRIBUTE}]`);
        const widestRow = Array.from(rows).reduce((widest, row) => Math.max(widest, row.offsetWidth), 0);
        const ratio = Math.min(
            availableHeight / line.offsetHeight,
            widestRow > 0 ? availableWidth / widestRow : Number.POSITIVE_INFINITY,
        );
        if (!(ratio < 1)) return;

        const next = Math.max(MIN_FIT, scale * ratio * FIT_SLACK);
        if (next < scale - 0.005) setFit({ key: lineKey, scale: next });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- layoutKeys stands for what changes the line's size
    }, [enabled, lineKey, scale, areaRef, ...layoutKeys]);

    return scale;
};
