// Shared progressive-grid state helpers for GridView and ArtistGridView.

export const GRID_INITIAL_BATCH_SIZE = 150;
export const GRID_BACKGROUND_BATCH_SIZE = 1000;

export const deriveProgressiveLoadingState = (
    itemCount: number,
    initialSourcesLoading: boolean,
    backgroundSourceLoading: boolean
) => ({
    initialLoading: itemCount === 0 && initialSourcesLoading,
    backgroundLoading: itemCount > 0 && (initialSourcesLoading || backgroundSourceLoading),
});

export const appendUniqueByKey = <T>(
    current: readonly T[],
    incoming: readonly T[],
    getKey: (item: T, index: number) => string
): T[] => {
    const seen = new Set(current.map((item, index) => getKey(item, index)));
    const next = [...current];
    incoming.forEach((item, index) => {
        const key = getKey(item, current.length + index);
        if (seen.has(key)) return;
        seen.add(key);
        next.push(item);
    });
    return next;
};
