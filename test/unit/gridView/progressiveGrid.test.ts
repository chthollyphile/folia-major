import { describe, expect, it } from 'vitest';
import { appendUniqueByKey, deriveProgressiveLoadingState } from '../../../src/components/folia-grid/progressiveGrid';
import { buildArtistGridCoords } from '../../../src/components/ArtistGridView';

// Unit coverage for progressive loading state and stable ArtistGrid album placement.

describe('progressiveGrid', () => {
    it('only blocks the grid while no usable items exist', () => {
        expect(deriveProgressiveLoadingState(0, true, false)).toEqual({
            initialLoading: true,
            backgroundLoading: false,
        });
        expect(deriveProgressiveLoadingState(20, true, true)).toEqual({
            initialLoading: false,
            backgroundLoading: true,
        });
    });

    it('appends retry pages without duplicating existing items', () => {
        const current = [{ id: 1 }, { id: 2 }];
        expect(appendUniqueByKey(current, [{ id: 2 }, { id: 3 }], item => String(item.id)))
            .toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    });

    it('keeps existing ArtistGrid album coordinates stable as albums are appended', () => {
        const first = buildArtistGridCoords(10, 5, 250, 320);
        const extended = buildArtistGridCoords(10, 25, 250, 320);
        expect(extended.slice(0, first.length)).toEqual(first);
        expect(new Set(extended.map(coord => `${coord.cube.x}:${coord.cube.y}:${coord.cube.z}`)).size)
            .toBe(extended.length);
    });
});
