import { beforeEach, describe, expect, it, vi } from 'vitest';
import { persistPlaybackCache } from '@/components/app/playback/persistPlaybackCache';
import { saveToCache } from '@/services/db';
import type { SongResult } from '@/types';

// test/unit/cache/persistPlaybackCache.test.ts

vi.mock('@/services/db', () => ({
    saveToCache: vi.fn(),
}));

const song = (id: number, name: string, patch: Partial<SongResult> = {}): SongResult => ({
    id,
    name,
    artists: [],
    album: { id: 1, name: 'Album' },
    duration: 1000,
    ...patch,
});

describe('persistPlaybackCache', () => {
    beforeEach(() => {
        vi.mocked(saveToCache).mockReset();
        vi.mocked(saveToCache).mockResolvedValue(undefined);
    });

    it('persists a mixed-source queue without discarding local or Navidrome entries', async () => {
        const netease = song(1, 'NetEase');
        const local = song(-1, 'Local', {
            isLocal: true,
            localRef: { songId: 'local-1' },
        } as Partial<SongResult>);
        const navidrome = song(-1, 'Navidrome', {
            isNavidrome: true,
            navidromeData: {
                id: 'navi-1',
                streamUrl: 'https://example.com/navi-1',
                albumId: 'album-1',
                artistId: 'artist-1',
                path: 'navi-1.flac',
                suffix: 'flac',
            },
        } as Partial<SongResult>);

        await persistPlaybackCache(local, [netease, local, navidrome]);

        expect(saveToCache).toHaveBeenCalledWith('last_queue', [
            netease,
            expect.objectContaining({
                isLocal: true,
                localRef: { songId: 'local-1' },
            }),
            navidrome,
        ]);
    });
});
