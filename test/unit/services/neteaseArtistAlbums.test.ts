import { afterEach, describe, expect, it, vi } from 'vitest';
import { neteaseApi } from '../../../src/services/netease';

// Regression coverage for complete artist-album pagination.
describe('netease artist albums', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('requests 50 albums per page until more is false and de-duplicates page overlap', async () => {
        const getPage = vi.spyOn(neteaseApi, 'getArtistAlbums')
            .mockResolvedValueOnce({ hotAlbums: [{ id: 1 }, { id: 2 }], more: true })
            .mockResolvedValueOnce({ hotAlbums: [{ id: 2 }, { id: 3 }], more: false });

        await expect(neteaseApi.getAllArtistAlbums(6452)).resolves.toEqual([
            { id: 1 },
            { id: 2 },
            { id: 3 },
        ]);
        expect(getPage).toHaveBeenNthCalledWith(1, 6452, 50, 0);
        expect(getPage).toHaveBeenNthCalledWith(2, 6452, 50, 50);
        expect(getPage).toHaveBeenCalledTimes(2);
    });
});
