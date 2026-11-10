// src/components/modal/settings/kit/popoverPlace.ts
// Where a layer that opens from a control goes: rectangles in, a position out. It touches no
// element, so the rule can be tested by itself. The Popover and the Tooltip both place with it.

/** Between the anchor and the layer. */
export const POPOVER_GAP = 6;
/** Kept free between the layer and the edges of its container. */
export const POPOVER_GUTTER = 8;

/** A rectangle. The three of one call are in the same coordinates: the viewport's, as getBoundingClientRect gives them. */
export type Box = { left: number; top: number; width: number; height: number };

/**
 * The box the layer is kept inside, and how far that box's own content is scrolled. A layer drawn
 * inside a scrolled container lies in its content, so its distances count from the scrolled edges.
 */
export type PopoverContainer = Box & { scrollLeft?: number; scrollTop?: number };

export type PopoverSide = 'under' | 'over';
export type PopoverAlign = 'start' | 'center' | 'end';

export type PopoverPlaceOptions = {
    /** The side asked for. */
    side: PopoverSide;
    /** The edge of the anchor the layer lines up with, or its centre. */
    align: PopoverAlign;
    /** As wide as the container, less the gutter at both sides. */
    fill?: boolean;
};

/** The position as distances from the container's edges: what the layer's `style` takes. */
export type PopoverPlace = {
    /** The side the layer is on. */
    side: PopoverSide;
    left?: number;
    /** A layer at its anchor's end hangs from its right edge: it grows to the left. */
    right?: number;
    top?: number;
    /** A layer over its anchor stands on its bottom edge: it grows upward. */
    bottom?: number;
    /** The room on that side. A taller layer scrolls inside itself. */
    maxHeight: number;
};

/**
 * Places a layer of the given size at its anchor, inside the container. It goes to the side asked
 * for; to the other one where it is too tall here and fits there; and where it fits on neither, to
 * the one with more room. Sideways it is moved in where it would pass the gutter.
 */
export const placePopover = (
    anchor: Box,
    layer: { width: number; height: number },
    container: PopoverContainer,
    { side, align, fill = false }: PopoverPlaceOptions,
): PopoverPlace => {
    const { scrollLeft = 0, scrollTop = 0 } = container;
    const room = {
        under: container.top + container.height - POPOVER_GUTTER - (anchor.top + anchor.height + POPOVER_GAP),
        over: anchor.top - POPOVER_GAP - (container.top + POPOVER_GUTTER),
    };
    const other: PopoverSide = side === 'under' ? 'over' : 'under';
    const placed = layer.height <= room[side] || (layer.height > room[other] && room[side] >= room[other]) ? side : other;
    const vertical = placed === 'under'
        ? { top: anchor.top + anchor.height + POPOVER_GAP - container.top + scrollTop }
        : { bottom: container.top + container.height - anchor.top + POPOVER_GAP - scrollTop };
    // A distance from the container's left or right edge, held between the two gutters.
    const inside = (distance: number) => Math.max(POPOVER_GUTTER, Math.min(distance, container.width - layer.width - POPOVER_GUTTER));
    const horizontal = fill
        ? { left: POPOVER_GUTTER + scrollLeft, right: POPOVER_GUTTER - scrollLeft }
        : align === 'end'
            ? { right: inside(container.left + container.width - (anchor.left + anchor.width)) - scrollLeft }
            : { left: inside(anchor.left - container.left + (align === 'center' ? (anchor.width - layer.width) / 2 : 0)) + scrollLeft };

    return { side: placed, ...horizontal, ...vertical, maxHeight: Math.max(0, room[placed]) };
};
