// src/components/folia-grid/gridMapNavigation.ts
// Keeps GridMap selections aligned with the source Grid3D collection after filtering or data refreshes.

export interface GridMapNavigableItem {
    id: string | number;
}

export const GRID_MAP_DRAG_SELECTION_THRESHOLD = 8;

/** Distinguishes an intentional grid drag from a card click using the shared 8px interaction threshold. */
export const shouldSuppressGridMapSelection = (
    offsetX: number,
    offsetY: number,
    threshold = GRID_MAP_DRAG_SELECTION_THRESHOLD,
) => Math.hypot(offsetX, offsetY) >= threshold;

/** Resolves a displayed GridMap item back to its stable index in the unfiltered source list. */
export const resolveGridMapSourceIndex = <T extends GridMapNavigableItem>(
    sourceItems: T[],
    selectedItem: T,
    fallbackIndex: number,
) => {
    const identityIndex = sourceItems.indexOf(selectedItem);
    if (identityIndex >= 0) return identityIndex;

    const idIndex = sourceItems.findIndex(item => item.id === selectedItem.id);
    if (idIndex >= 0) return idIndex;

    if (sourceItems.length === 0) return 0;
    return Math.min(Math.max(0, fallbackIndex), sourceItems.length - 1);
};

/** Finds where the source collection's current focus appears in a filtered GridMap list. */
export const resolveGridMapDisplayIndex = <T extends GridMapNavigableItem>(
    displayedItems: T[],
    sourceItem: T | undefined,
) => {
    if (!sourceItem) return 0;

    const identityIndex = displayedItems.indexOf(sourceItem);
    if (identityIndex >= 0) return identityIndex;

    const idIndex = displayedItems.findIndex(item => item.id === sourceItem.id);
    return idIndex >= 0 ? idIndex : 0;
};
