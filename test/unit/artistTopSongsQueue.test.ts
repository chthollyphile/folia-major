import { describe, expect, it, vi } from 'vitest';
import type { SongResult } from '../../src/types';
vi.mock('../../src/services/onlineMusic/songAvailability', () => ({ askPlayedSong: () => null,
    isSongUnavailable: (s: { unavailable?: boolean } | null) => Boolean(s?.unavailable),
}));

import { addArtistTopSongsToQueue, selectQueueableTopSongs } from '../../src/utils/artistTopSongsQueue';

const song = (id: number, extra: Record<string, unknown> = {}) => ({ id, name: `s${id}`, ...extra }) as unknown as SongResult;
const t = (key: string, options?: Record<string, unknown>) => `${key}:${options?.count ?? ''}`;

describe('artist top songs to queue', () => {
    it('keeps display order and drops unavailable songs and duplicates', () => {
        const result = selectQueueableTopSongs([song(3), song(1, { unavailable: true }), song(2), song(3)]);
        expect(result.map(s => s.id)).toEqual([3, 2]);
    });

    it('passes queueable songs with the toast suppressed and reports the count the queue took', () => {
        const addAll = vi.fn(() => 2);
        const setStatus = vi.fn();
        const added = addArtistTopSongsToQueue({ songs: [song(1), song(2), song(2)], addAllToQueue: addAll, setStatus, t });
        expect(added).toBe(2);
        expect(addAll).toHaveBeenCalledTimes(1);
        expect((addAll.mock.calls[0] as any[])[0].map((s: SongResult) => s.id)).toEqual([1, 2]);
        expect((addAll.mock.calls[0] as any[])[1]).toEqual({ suppressToast: true });
        expect(setStatus.mock.calls[0][0]).toMatchObject({ type: 'success', text: 'artistGrid.topSongsAddedToQueue:2' });
    });

    it('falls back to the queueable length when the handler reports nothing', () => {
        const setStatus = vi.fn();
        expect(addArtistTopSongsToQueue({ songs: [song(1), song(2)], addAllToQueue: () => undefined, setStatus, t })).toBe(2);
    });

    it('does not call the queue when nothing is queueable and shows an info toast', () => {
        const addAll = vi.fn();
        const setStatus = vi.fn();
        expect(addArtistTopSongsToQueue({ songs: [song(1, { unavailable: true })], addAllToQueue: addAll, setStatus, t })).toBe(0);
        expect(addAll).not.toHaveBeenCalled();
        expect(setStatus.mock.calls[0][0]).toMatchObject({ type: 'info' });
    });

    it('does nothing without a queue handler', () => {
        const setStatus = vi.fn();
        expect(addArtistTopSongsToQueue({ songs: [song(1)], setStatus, t })).toBe(0);
        expect(setStatus).not.toHaveBeenCalled();
    });
});
