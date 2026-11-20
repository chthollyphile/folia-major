import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FoliumSourceSong } from '@/mods/folium/sources/contract';
import { qrcDecrypt } from '../../../sources/qq/core/qrcDecrypt';
import { fetchQQLyrics, searchQQSongs } from '../../../sources/qq/core/qqLyricProvider';
import { createQqCore } from '../helpers/qqSource';

// test/unit/lyrics/qqLyricProvider.test.ts
// Verifies QQ's anonymous lyric request hands over the optional romanization track (the host parses the tracks), and
// that the anonymous song search the lyric match uses stays anonymous. Only the core (createQqCore, the web build: the
// requests go through the lyric relay to the stubbed fetch).

vi.mock('../../../sources/qq/core/qrcDecrypt', () => ({
    qrcDecrypt: vi.fn(),
}));

// The lyric request needs the numeric songid (the song's data) beside the songmid (its id).
const song: FoliumSourceSong = {
    id: 'qq-mid',
    title: 'Test song',
    artists: [{ id: '', name: 'Artist' }],
    album: { id: '', name: 'Album' },
    durationMs: 60_000,
    data: { songId: 42 },
};

beforeAll(async () => {
    await createQqCore();
});

describe('QQ lyric provider', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('fetches QQ romanization anonymously', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
                code: 0,
                request: { code: 0, data: { lyric: 'orig', trans: 'trans', roma: 'roma', roma_t: 1 } },
            })));
        vi.stubGlobal('fetch', fetchMock);
        vi.mocked(qrcDecrypt).mockImplementation(async value => ({
            orig: '[00:01.00]君のことが好き',
            trans: '[00:01.00]我喜欢你',
            roma: '[00:01.00]Kimi no koto ga suki',
        })[String(value)] || '');

        const lyrics = await fetchQQLyrics(song);

        expect(lyrics?.main).toMatchObject({
            format: 'lrc',
            text: '[00:01.00]君のことが好き',
            translationText: '[00:01.00]我喜欢你',
            romanizationText: '[00:01.00]Kimi no koto ga suki',
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const lyricRequestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        expect(lyricRequestBody.comm).toEqual(expect.objectContaining({ uid: '0' }));
        expect(lyricRequestBody.comm).not.toHaveProperty('sid');
        expect(lyricRequestBody.comm).not.toHaveProperty('userip');
        expect(lyricRequestBody.request.param).toMatchObject({ roma: 1, roma_t: 0 });
    });

    it('keeps QQ lyric searches anonymous', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            code: 0,
            request: { code: 0, data: { body: { item_song: [] } } },
        })));
        vi.stubGlobal('fetch', fetchMock);

        await expect(searchQQSongs('test')).resolves.toEqual([]);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const searchRequestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        expect(searchRequestBody.request.method).toBe('DoSearchForQQMusicLite');
        // search_type 0 is answered 2001 with no items for every query; 7 is the one QQ still answers (#695).
        expect(searchRequestBody.request.param.search_type).toBe(7);
    });

    it('normalizes QQ search covers and duration for metadata matching', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            code: 0,
            request: {
                code: 0,
                data: {
                    body: {
                        item_song: [{
                            id: 42,
                            mid: 'song-mid',
                            title: 'Test song',
                            interval: 60,
                            singer: [{ id: 1, name: 'Artist' }],
                            album: { id: 2, mid: 'album-mid', name: 'Album' },
                        }],
                    },
                },
            },
        })));
        vi.stubGlobal('fetch', fetchMock);

        const [result] = await searchQQSongs('Test song');

        expect(result).toMatchObject({
            durationMs: 60_000,
            album: {
                coverUrl: 'https://y.gtimg.cn/music/photo_new/T002M000album-mid.jpg?max_age=2592000',
            },
        });
    });
});
