import { describe, expect, it } from 'vitest';
import { deriveProgressiveLoadingState } from '../../../src/library/suites/grid/shared/progressiveGrid';
import { appendUniqueByKey } from '../../../src/library/core/collection/collectionPaging';
import { buildArtistGridCoords } from '../../../src/library/suites/grid/artist/ArtistGridView';
import { artistAlbumCoverUrl as getArtistGridAlbumCoverUrl } from '../../../src/library/core/artist/artistModel';

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

    it('reads canonical provider collection covers before legacy album fields', () => {
        expect(getArtistGridAlbumCoverUrl({ coverUrl: 'http://cdn.example.com/album.jpg', picUrl: 'legacy.jpg' }))
            .toBe('https://cdn.example.com/album.jpg');
        expect(getArtistGridAlbumCoverUrl({ picUrl: 'legacy.jpg' })).toBeUndefined();
    });
});
