import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/services/neteaseDailyRecommendations.test.ts
// Covers the daily recommendation endpoints and their normalized client-facing shapes.

const mockJsonResponse = (payload: unknown) => ({
    json: vi.fn().mockResolvedValue(payload),
});

const createSong = (id: number, name: string) => ({
    id,
    name,
    ar: [{ id: 1, name: 'Artist' }],
    al: { id: 2, name: 'Album', picUrl: 'http://example.com/cover.jpg' },
    dt: 1234,
});

describe('netease daily recommendations', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.restoreAllMocks();
        vi.stubEnv('VITE_NETEASE_API_BASE', 'http://127.0.0.1:3000');
        vi.stubGlobal('localStorage', {
            getItem: vi.fn((key: string) => key === 'netease_cookie' ? 'mock-user-cookie' : null),
            setItem: vi.fn(),
            removeItem: vi.fn(),
        });
        vi.stubGlobal('window', {});
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it('loads and normalizes refreshed daily songs', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(mockJsonResponse({
            code: 200,
            data: {
                dailySongs: [createSong(10, 'Daily Song')],
                privileges: [{ id: 10, st: 0, pl: 320000 }],
            },
        }) as any);

        const { neteaseApi } = await import('@/services/netease');
        const result = await neteaseApi.getDailyRecommendedSongs(true);

        expect(result.songs[0]).toMatchObject({
            id: 10,
            name: 'Daily Song',
            privilege: { st: 0, pl: 320000 },
        });
        expect(result.songs[0].album.coverUrl).toBe('https://example.com/cover.jpg');
        expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain('/recommend/songs?afresh=true&timestamp=');
    });

    it('normalizes the replacement returned after marking a song as disliked', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(mockJsonResponse({
            code: 200,
            data: createSong(11, 'Replacement Song'),
        }) as any);

        const { neteaseApi } = await import('@/services/netease');
        const result = await neteaseApi.dislikeDailyRecommendedSong(10);

        expect(result.song).toMatchObject({ id: 11, name: 'Replacement Song' });
        expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain('/recommend/songs/dislike?id=10&timestamp=');
    });

    it('preserves the daily dislike limit response without creating a replacement song', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(mockJsonResponse({
            code: 432,
            message: '今日暂无更多推荐',
        }) as any);

        const { neteaseApi } = await import('@/services/netease');
        const result = await neteaseApi.dislikeDailyRecommendedSong(10);

        expect(result).toMatchObject({
            code: 432,
            message: '今日暂无更多推荐',
            song: null,
        });
    });

    it('normalizes available history dates', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(mockJsonResponse({
            code: 200,
            data: {
                dates: ['2026-07-12', { date: '2026-07-11' }, { invalid: true }],
            },
        }) as any);

        const { neteaseApi } = await import('@/services/netease');
        const result = await neteaseApi.getDailyRecommendationHistoryDates();

        expect(result.dates).toEqual(['2026-07-12', '2026-07-11']);
        expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain('/history/recommend/songs?timestamp=');
    });

    it('loads historical recommendation details for the selected date', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(mockJsonResponse({
            code: 200,
            data: { songs: [createSong(12, 'History Song')] },
        }) as any);

        const { neteaseApi } = await import('@/services/netease');
        const result = await neteaseApi.getDailyRecommendationHistoryDetail('2026-07-12');

        expect(result.songs[0]).toMatchObject({ id: 12, name: 'History Song' });
        expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain('/history/recommend/songs/detail?date=2026-07-12&timestamp=');
    });
});
