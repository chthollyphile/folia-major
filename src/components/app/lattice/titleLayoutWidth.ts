// src/components/app/lattice/titleLayoutWidth.ts — the column a poster's title will occupy.

/**
 * The layout width the title box will settle at when its poster reaches `posterWidth`.
 *
 * Used for every poster, not only an expanding one: the wall knows each card's rect in world units
 * before anything is laid out, and world width is what the title is measured against - the camera
 * scale is a transform, so it never enters this.
 *
 * Read from the live cascade rather than duplicated from the stylesheet: the copy block's insets
 * resolve to pixels because it is absolutely positioned, and a percentage `max-width` survives in
 * the computed value. `posterWidth` is the poster's target rect in world units, so the camera scale
 * never enters the arithmetic. Returns null when the shape this relies on does not hold, which
 * callers must treat as "do not predict" rather than as a width of zero.
 */
export function titleLayoutWidth(node: HTMLElement, posterWidth: number): number | null {
    const column = readTitleColumn(node);
    return column && titleColumnWidth(column, posterWidth);
}

/** What the cascade contributes to the column: the copy block's insets and the title's own cap. */
export type TitleColumn = {
    /** Horizontal insets, padding and borders of the copy block, in pixels. */
    inset: number;
    /** The title's computed `max-width`, kept as written so a percentage can follow the poster. */
    maxWidth: string;
};

/**
 * The two computed-style reads behind `titleLayoutWidth`, separated so a caller can take them once
 * and apply them to every poster of the same shape: a compact card and an expanded one differ, but
 * within a shape the cascade gives every card the same insets, so nothing here depends on which
 * poster is asking.
 */
export function readTitleColumn(node: HTMLElement): TitleColumn | null {
    const box = node.parentElement;
    if (!box) return null;
    const style = getComputedStyle(box);
    if (style.position !== 'absolute') return null;
    const inset = parseFloat(style.left) + parseFloat(style.right)
        + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
        + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    if (!Number.isFinite(inset)) return null;
    return { inset, maxWidth: getComputedStyle(node).maxWidth };
}

/** The arithmetic half of `titleLayoutWidth`; null where the poster leaves no room for a title. */
export function titleColumnWidth(column: TitleColumn, posterWidth: number): number | null {
    const available = posterWidth - column.inset;
    if (!(available > 0)) return null;
    if (column.maxWidth.endsWith('%')) return available * parseFloat(column.maxWidth) / 100;
    const pixels = parseFloat(column.maxWidth);
    return Number.isFinite(pixels) ? Math.min(available, pixels) : available;
}
