import { beforeEach, describe, expect, it, vi } from 'vitest';
import { neteaseApi } from '@/services/netease';
import { neteaseProvider } from '@/services/onlineMusic/neteaseProvider';
import type { UnifiedSong } from '@/types';

// test/unit/onlineMusic/neteaseProvider.test.ts

vi.mock('@/services/netease', () => ({
    neteaseApi: {
        normalizeSongResult: vi.fn((raw: unknown) => raw),
        getSongUrl: vi.fn(),
        cloudSearch: vi.fn(),
        checkQr: vi.fn(),
    },
}));

const song: UnifiedSong = {
    id: 42,
    name: 'Song',
    artists: [],
    album: { id: 1, name: 'Album' },
    duration: 1000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: '42' },
};

describe('neteaseProvider', () => {
    beforeEach(() => vi.clearAllMocks());

    it('maps semantic high quality to the NetEase exhigh value', async () => {
        vi.mocked(neteaseApi.getSongUrl).mockResolvedValue({ data: [{ url: 'http://music.test/song.mp3' }] } as any);
        await expect(neteaseProvider.playback!.getAudioSource(song, 'high')).resolves.toMatchObject({
            url: 'https://music.test/song.mp3',
            quality: 'high',
        });
        expect(neteaseApi.getSongUrl).toHaveBeenCalledWith(42, 'exhigh');
    });

    it('normalizes search results and paging metadata', async () => {
        vi.mocked(neteaseApi.cloudSearch).mockResolvedValue({
            result: { songs: [{ ...song, sourceRef: undefined }], songCount: 2 },
        } as any);
        const page = await neteaseProvider.search!.searchSongs('song', 1, 0);
        expect(page.items[0].sourceRef).toEqual({ kind: 'online', providerId: 'netease', mediaId: '42' });
        expect(page).toMatchObject({ total: 2, hasMore: true, nextOffset: 1 });
    });

    it.each([
        [801, 'waiting'],
        [802, 'scanned'],
        [803, 'confirmed'],
        [800, 'expired'],
    ])('maps QR code %s to %s', async (code, state) => {
        vi.mocked(neteaseApi.checkQr).mockResolvedValue({ code } as any);
        await expect(neteaseProvider.auth!.checkQr!('key')).resolves.toMatchObject({ state });
    });
});
