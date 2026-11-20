import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clearAmllDbLyricsCache,
    fetchAmllDbLyrics,
    getAmllDbMusicIds,
    searchAmllDbSongs,
} from '@/utils/lyrics/providers/amllDbProvider';
import { parseLyricsByFormat } from '@/utils/lyrics/parserCore';

// test/unit/lyrics/amllDbProvider.test.ts
// 响应结构取自 2026-10-08 对 https://api.amll.dev 的真实请求。

vi.mock('@/utils/lyrics/parserCore', () => ({
    parseLyricsByFormat: vi.fn()
}));

const TTML = '<tt xmlns="http://www.w3.org/ns/ttml"><body /></tt>';

const songItem = (overrides: Record<string, unknown> = {}) => ({
    id: 5350574665814138,
    filename: '1689103578000-39523898-85d330ae.ttml',
    createdAt: 1689103578000,
    musicNames: ['Idol'],
    artistNames: ['YOASOBI'],
    albumNames: ['Idol'],
    ncmMusicIds: ['2048982668'],
    qqMusicIds: [],
    appleMusicIds: [],
    spotifyIds: [],
    isrcs: [],
    authorIds: ['39523898'],
    authorUsernames: ['Steve-xmh'],
    ...overrides,
});

const jsonResponse = (status: number, body: unknown) => ({
    status,
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
});

const lyricsHit = (lyrics: string | null = TTML) => jsonResponse(200, {
    status: 200,
    data: songItem({ lyrics, format: 'ttml' }),
});

const notFound = () => jsonResponse(404, {
    status: 404,
    error: 'Not Found',
    message: 'No lyrics found for the provided query.',
});

const parsedLyrics = {
    lines: [{ fullText: 'Hello', startTime: 0, endTime: 1, words: [] }],
    isWordByWord: true,
};

describe('amllDbProvider', () => {
    const fetchMock = vi.fn();
    const parseLyricsByFormatMock = vi.mocked(parseLyricsByFormat);

    beforeEach(() => {
        vi.resetAllMocks();
        clearAmllDbLyricsCache();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('requests the official API directly and parses data.lyrics', async () => {
        fetchMock.mockResolvedValue(lyricsHit());
        parseLyricsByFormatMock.mockReturnValue(parsedLyrics);

        const result = await fetchAmllDbLyrics('ncm', 2048982668);

        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.amll.dev/v1/lyrics/get?ncmMusicId=2048982668',
            expect.objectContaining({
                credentials: 'omit',
                signal: expect.any(AbortSignal),
            })
        );
        // 浏览器直连不能带自定义请求头：会触发 CORS 预检，浏览器也不允许改 UA
        expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('headers');
        expect(parseLyricsByFormatMock).toHaveBeenCalledWith('ttml', TTML);
        expect(result?.isWordByWord).toBe(true);
    });

    it('uses qqMusicId for QQ lookups', async () => {
        fetchMock.mockResolvedValue(notFound());

        await fetchAmllDbLyrics('qq', '000zi9gH0OEMMu');

        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.amll.dev/v1/lyrics/get?qqMusicId=000zi9gH0OEMMu',
            expect.any(Object)
        );
    });

    it('sets a request timeout', async () => {
        const timeoutSignal = new AbortController().signal;
        const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutSignal);
        fetchMock.mockResolvedValue(notFound());

        await fetchAmllDbLyrics('ncm', 123);

        expect(timeoutSpy).toHaveBeenCalledWith(5000);
        expect(fetchMock).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ signal: timeoutSignal })
        );
    });

    it('returns null for 404 responses', async () => {
        fetchMock.mockResolvedValue(notFound());

        await expect(fetchAmllDbLyrics('qq', 'abc')).resolves.toBeNull();
        expect(parseLyricsByFormatMock).not.toHaveBeenCalled();
    });

    it('returns null and warns when rate limited', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        fetchMock.mockResolvedValue(jsonResponse(429, { status: 429, error: 'Too Many Requests', message: '' }));

        await expect(fetchAmllDbLyrics('ncm', 123)).resolves.toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Rate limited'));
    });

    it('returns null when the response body is not JSON', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        fetchMock.mockResolvedValue({ status: 200, text: vi.fn().mockResolvedValue('<html>bad gateway</html>') });

        await expect(fetchAmllDbLyrics('ncm', 123)).resolves.toBeNull();
    });

    it('returns null when the envelope status is not 200 or data is empty', async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse(200, { status: 500, error: 'Internal', message: '' }))
            .mockResolvedValueOnce(jsonResponse(200, { status: 200, data: null }));

        await expect(fetchAmllDbLyrics('ncm', 1)).resolves.toBeNull();
        await expect(fetchAmllDbLyrics('ncm', 2)).resolves.toBeNull();
        expect(parseLyricsByFormatMock).not.toHaveBeenCalled();
    });

    it('returns null when the request fails', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        fetchMock.mockRejectedValue(new TypeError('fetch failed'));

        await expect(fetchAmllDbLyrics('ncm', 123)).resolves.toBeNull();
    });

    it('goes through the electron proxy without a UA when build constants are missing', async () => {
        const fetchLyricProxy = vi.fn().mockResolvedValue({
            ok: false, status: 404, statusText: 'Not Found', headers: {}, bodyText: '',
        });
        vi.stubGlobal('window', { electron: { fetchLyricProxy } });

        await expect(fetchAmllDbLyrics('qq', 105094238)).resolves.toBeNull();
        expect(fetchLyricProxy).toHaveBeenCalledWith(
            'https://api.amll.dev/v1/lyrics/get?qqMusicId=105094238',
            { method: 'GET' },
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends the Folia UA through the electron proxy', async () => {
        vi.stubGlobal('__APP_VERSION__', '0.7.16');
        vi.stubGlobal('__BUILD_COMMIT__', '537fa57');
        vi.stubGlobal('__BUILD_REPO__', 'chthollyphile/folia-major');
        const fetchLyricProxy = vi.fn().mockResolvedValue({
            ok: true, status: 200, statusText: 'OK', headers: {},
            bodyText: JSON.stringify({ status: 200, data: songItem({ lyrics: TTML }) }),
        });
        vi.stubGlobal('window', { electron: { fetchLyricProxy } });
        parseLyricsByFormatMock.mockReturnValue(parsedLyrics);

        await expect(fetchAmllDbLyrics('ncm', 2048982668)).resolves.toBe(parsedLyrics);
        expect(fetchLyricProxy).toHaveBeenCalledWith(
            'https://api.amll.dev/v1/lyrics/get?ncmMusicId=2048982668',
            { method: 'GET', headers: { 'User-Agent': 'Folia/0.7.16-537fa57 (chthollyphile/folia-major)' } },
        );
    });

    it('reuses cached fetch results for the same platform id', async () => {
        fetchMock.mockResolvedValue(lyricsHit());
        parseLyricsByFormatMock.mockReturnValue(parsedLyrics);

        const first = await fetchAmllDbLyrics('ncm', 123);
        const second = await fetchAmllDbLyrics('ncm', '123');

        expect(first).toBe(second);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(parseLyricsByFormatMock).toHaveBeenCalledTimes(1);
    });

    it('tries each id in order and stops at the first hit', async () => {
        fetchMock
            .mockResolvedValueOnce(notFound())
            .mockResolvedValueOnce(lyricsHit());
        parseLyricsByFormatMock.mockReturnValue(parsedLyrics);

        const ids = getAmllDbMusicIds('qq', { id: 105094238, qqMid: '000zi9gH0OEMMu' });
        const result = await fetchAmllDbLyrics('qq', ids);

        expect(ids).toEqual(['000zi9gH0OEMMu', '105094238']);
        expect(result).toBe(parsedLyrics);
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
            'https://api.amll.dev/v1/lyrics/get?qqMusicId=000zi9gH0OEMMu',
            'https://api.amll.dev/v1/lyrics/get?qqMusicId=105094238',
        ]);
    });

    it('skips empty and duplicate ids', async () => {
        fetchMock.mockResolvedValue(notFound());

        await expect(fetchAmllDbLyrics('qq', [undefined, '', 42, '42'])).resolves.toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('only uses the song id for NetEase', () => {
        expect(getAmllDbMusicIds('ncm', { id: 101, qqMid: 'ignored' })).toEqual(['101']);
    });

    it('drops a missing QQ mid instead of returning an empty id', () => {
        expect(getAmllDbMusicIds('qq', { id: 202 })).toEqual(['202']);
        expect(getAmllDbMusicIds('qq', { id: 'mid', qqMid: 'mid' })).toEqual(['mid']);
    });

    // A song of the QQ source mod is known by its mid; the numeric id rides in its providerData.
    it('tries the numeric id a QQ source-mod song keeps in its providerData after the mid', () => {
        expect(getAmllDbMusicIds('qq', {
            id: '000zi9gH0OEMMu',
            qqMid: '000zi9gH0OEMMu',
            sourceRef: { kind: 'online', providerId: 'qq', mediaId: '000zi9gH0OEMMu', providerData: { songId: 105094238 } },
        })).toEqual(['000zi9gH0OEMMu', '105094238']);
        expect(getAmllDbMusicIds('ncm', {
            id: 101,
            sourceRef: { kind: 'online', providerId: 'netease', mediaId: '101', providerData: { songId: 7 } },
        })).toEqual(['101']);
    });

    it('returns null for non-TTML lyrics', async () => {
        fetchMock.mockResolvedValue(lyricsHit('not found'));

        await expect(fetchAmllDbLyrics('qq', 456)).resolves.toBeNull();
        expect(parseLyricsByFormatMock).not.toHaveBeenCalled();
    });

    it('returns null when parsing fails', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        fetchMock.mockResolvedValue(lyricsHit('<tt></tt>'));
        parseLyricsByFormatMock.mockImplementation(() => {
            throw new Error('bad ttml');
        });

        await expect(fetchAmllDbLyrics('ncm', 789)).resolves.toBeNull();
    });

    describe('searchAmllDbSongs', () => {
        it('searches with q and pageSize and returns items', async () => {
            const items = [songItem(), songItem({ id: 2343999253428740, createdAt: 1689089845000 })];
            fetchMock.mockResolvedValue(jsonResponse(200, {
                status: 200,
                data: { items, pagination: { page: 1, pageSize: 50, total: 2, totalPages: 1, hasMore: false } },
            }));

            await expect(searchAmllDbSongs({ q: 'Idol YOASOBI' }, 50)).resolves.toEqual(items);
            expect(fetchMock).toHaveBeenCalledWith(
                'https://api.amll.dev/v1/lyrics/search?q=Idol+YOASOBI&pageSize=50',
                expect.any(Object)
            );
        });

        it('sends structured musicName / artistName and omits empty ones', async () => {
            fetchMock.mockResolvedValue(jsonResponse(200, {
                status: 200,
                data: { items: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0, hasMore: false } },
            }));

            await expect(searchAmllDbSongs({ musicName: '夜に駆ける', artistName: 'YOASOBI' }, 50)).resolves.toEqual([]);
            await searchAmllDbSongs({ musicName: 'Idol', artistName: '' }, 50);

            expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
                `https://api.amll.dev/v1/lyrics/search?${new URLSearchParams({ musicName: '夜に駆ける', artistName: 'YOASOBI', pageSize: '50' })}`,
                'https://api.amll.dev/v1/lyrics/search?musicName=Idol&pageSize=50',
            ]);
        });

        it('returns null instead of an empty list when the request fails or is rate limited', async () => {
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            fetchMock
                .mockRejectedValueOnce(new TypeError('fetch failed'))
                .mockResolvedValueOnce(jsonResponse(429, { status: 429, error: 'Too Many Requests', message: '' }));

            await expect(searchAmllDbSongs({ q: 'Idol' }, 50)).resolves.toBeNull();
            await expect(searchAmllDbSongs({ q: 'Idol' }, 50)).resolves.toBeNull();
        });
    });
});
