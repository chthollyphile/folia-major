import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { neteaseApi } from '@/services/netease';
import { neteaseProvider } from '@/services/onlineMusic/neteaseProvider';

// test/unit/onlineMusic/neteaseHeartbeat.test.ts
// Exercises the provider boundary with the real song normalizer and mocked upstream responses.

const options = { playlistId: '123', seedSongId: '456', startSongId: '789' };
const songInfo = (id?: number) => ({
    id, name: 'Heartbeat Song', ar: [{ id: 1, name: 'Artist' }],
    al: { id: 2, name: 'Album', picUrl: 'https://example.com/cover.jpg' }, dt: 123000,
});
const request = () => neteaseProvider.recommendations!.getHeartbeatSongs!(options);

describe('NetEase heartbeat recommendations', () => {
    beforeEach(() => { vi.spyOn(neteaseApi, 'getHeartbeatSongs'); });
    afterEach(() => vi.restoreAllMocks());

    it('maps the seed and playlist IDs and unwraps songInfo with source identity', async () => {
        vi.mocked(neteaseApi.getHeartbeatSongs).mockResolvedValue({
            code: 200, data: [{ id: 42, songInfo: songInfo(42) }, { id: 43, songInfo: songInfo() }],
        });

        const songs = await request();

        expect(neteaseProvider.capabilities.heartbeatRecommendations).toBe(true);
        expect(neteaseApi.getHeartbeatSongs).toHaveBeenCalledWith(456, 123, 789);
        expect(songs.map(song => song.id)).toEqual([42, 43]);
        expect(songs[0]).toMatchObject({
            name: 'Heartbeat Song', artists: [{ id: 1, name: 'Artist' }], durationMs: 123000,
            album: { id: 2, name: 'Album' },
            sourceRef: { kind: 'online', providerId: 'netease', mediaId: '42' },
        });
    });

    it('keeps an empty recommendation result distinct from an invalid response', async () => {
        vi.mocked(neteaseApi.getHeartbeatSongs).mockResolvedValue({ code: 200, data: [] });
        await expect(request()).resolves.toEqual([]);
    });

    it('drops malformed entries without disturbing valid recommendation order', async () => {
        vi.mocked(neteaseApi.getHeartbeatSongs).mockResolvedValue({
            code: 200, data: [null, { id: 0, songInfo: songInfo(0) }, { id: 9, songInfo: songInfo(9) }, { id: 10 }],
        });
        await expect(request()).resolves.toMatchObject([{ id: 9 }]);
    });

    it.each([{ code: 200 }, { code: 200, data: {} }, { code: 200, data: [{ id: 0 }] }])(
        'rejects malformed successful responses', async response => {
            vi.mocked(neteaseApi.getHeartbeatSongs).mockResolvedValue(response);
            await expect(request()).rejects.toMatchObject({ code: 'invalid-response', providerId: 'netease' });
        },
    );

    it.each([301, 401, 500])('preserves upstream failure code %s and its message', async code => {
        const response = { code, message: 'Upstream failure' };
        vi.mocked(neteaseApi.getHeartbeatSongs).mockResolvedValue(response);
        await expect(request()).rejects.toMatchObject({
            code: code === 500 ? 'unavailable' : 'auth-required', message: response.message, cause: response,
        });
    });

    it('does not turn transport failures into empty recommendations', async () => {
        const error = new Error('offline');
        vi.mocked(neteaseApi.getHeartbeatSongs).mockRejectedValue(error);
        await expect(request()).rejects.toBe(error);
    });

    it.each([0, -1, NaN, 1.5, 'not-a-song', Number.MAX_SAFE_INTEGER + 1])('rejects invalid seed %s before requesting', async seedSongId => {
        await expect(neteaseProvider.recommendations!.getHeartbeatSongs!({ ...options, seedSongId }))
            .rejects.toMatchObject({ code: 'unavailable' });
        expect(neteaseApi.getHeartbeatSongs).not.toHaveBeenCalled();
    });
});
