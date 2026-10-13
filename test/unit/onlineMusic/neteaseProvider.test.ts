import { beforeEach, describe, expect, it, vi } from 'vitest';
import { neteaseApi } from '@/services/netease';
import { neteaseProvider } from '@/services/onlineMusic/neteaseProvider';
import type { UnifiedSong } from '@/types';
import { OnlineProviderError } from '@/types/onlineMusic';
import { parseLyricsAsync } from '@/utils/lyrics/workerClient';

// test/unit/onlineMusic/neteaseProvider.test.ts

vi.mock('@/services/netease', () => ({
    isSongMarkedUnavailable: (candidate: UnifiedSong) => candidate.privilege?.st === -200,
    getNeteaseRemoteApiBase: () => null,
    neteaseApi: {
        normalizeSongResult: vi.fn((raw: unknown) => raw),
        getSongUrl: vi.fn(),
        getLyric: vi.fn(),
        getUnavailableSongReplacement: vi.fn(),
        cloudSearch: vi.fn(),
        getAlbum: vi.fn(),
        getArtistDetail: vi.fn(),
        getArtistAlbums: vi.fn(),
        getPersonalizedPlaylists: vi.fn(),
        getLikedSongs: vi.fn(),
        getUserPlaylists: vi.fn(),
        checkQr: vi.fn(),
        getQrKey: vi.fn(),
        createQr: vi.fn(),
        scrobbleV1: vi.fn(),
        getTopPlaylists: vi.fn(),
        getSimilarSongs: vi.fn(),
        getPersonalizedNewSongs: vi.fn(),
        getDailyRecommendedSongs: vi.fn(),
        getSearchSuggest: vi.fn(),
        searchByType: vi.fn(),
        createPlaylist: vi.fn(),
        getSongComments: vi.fn(),
        getCommentFloor: vi.fn(),
        likeSongComment: vi.fn(),
    },
}));

vi.mock('@/utils/lyrics/workerClient', () => ({
    parseLyricsAsync: vi.fn(),
}));

const song: UnifiedSong = {
    id: 42,
    name: 'Song',
    artists: [],
    album: { id: 1, name: 'Album' },
    durationMs: 1000,
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

    it('maps NetEase track gain from the URL response and keeps negative dB values', async () => {
        vi.mocked(neteaseApi.getSongUrl).mockResolvedValue({
            data: [{ url: 'https://music.test/song.flac', gain: -7.25 }],
        } as any);

        await expect(neteaseProvider.playback!.getAudioSource(song, 'lossless')).resolves.toMatchObject({
            replayGain: { trackGain: -7.25 },
        });
    });

    it('does not create ReplayGain metadata when NetEase omits gain', async () => {
        vi.mocked(neteaseApi.getSongUrl).mockResolvedValue({
            data: [{ url: 'https://music.test/song.mp3' }],
        } as any);

        const source = await neteaseProvider.playback!.getAudioSource(song, 'high');

        expect(source?.replayGain).toBeUndefined();
    });

    it('exposes NetEase romanization alongside the parsed lyric result', async () => {
        vi.mocked(parseLyricsAsync).mockResolvedValue({
            lines: [{
                words: [],
                fullText: '君のことが好き',
                startTime: 1,
                endTime: 2,
                translation: '我喜欢你',
                romanization: 'Kimi no koto ga suki',
            }],
        });
        vi.mocked(neteaseApi.getLyric).mockResolvedValue({
            lrc: { lyric: '[00:01.00]君のことが好き' },
            tlyric: { lyric: '[00:01.00]我喜欢你' },
            romalrc: { lyric: '[00:01.00]Kimi no koto ga suki' },
        } as any);

        await expect(neteaseProvider.lyrics!.getLyrics(song)).resolves.toMatchObject({
            romanizationText: '[00:01.00]Kimi no koto ga suki',
            lyrics: {
                lines: [{
                    translation: '我喜欢你',
                    romanization: 'Kimi no koto ga suki',
                }],
            },
        });
    });

    it('normalizes search results and paging metadata', async () => {
        vi.mocked(neteaseApi.cloudSearch).mockResolvedValue({
            result: { songs: [{ ...song, sourceRef: undefined }], songCount: 2 },
        } as any);
        const page = await neteaseProvider.search!.searchSongs('song', 1, 0);
        expect(page.items[0].sourceRef).toEqual({ kind: 'online', providerId: 'netease', mediaId: '42' });
        expect(page).toMatchObject({ total: 2, hasMore: true, nextOffset: 1 });
    });

    it('normalizes album collection metadata into provider fields', async () => {
        vi.mocked(neteaseApi.getArtistAlbums).mockResolvedValue({
            hotAlbums: [{
                id: 7,
                name: 'Album',
                picUrl: 'https://example.test/album.jpg',
                artist: { id: 9, name: 'Artist' },
                alias: ['Alias'],
                publishTime: 1704067200000,
                company: 'Publisher',
            }],
            more: false,
        } as any);

        const page = await neteaseProvider.catalog!.getArtistAlbums!(9, 10, 0);
        expect(page.items[0]).toMatchObject({
            id: 7,
            coverUrl: 'https://example.test/album.jpg',
            artists: [{ id: 9, name: 'Artist' }],
            aliases: ['Alias'],
            publishedAt: 1704067200000,
            publisher: 'Publisher',
        });
    });

    it('normalizes artist and full album biographies into the unified description field', async () => {
        vi.mocked(neteaseApi.getArtistDetail).mockResolvedValue({
            data: {
                artist: {
                    id: 9,
                    name: 'Artist',
                    briefDesc: 'Artist biography',
                    musicSize: 12,
                    albumSize: 3,
                },
            },
        } as any);
        vi.mocked(neteaseApi.getAlbum).mockResolvedValue({
            album: {
                id: 7,
                name: 'Album',
                picUrl: 'https://example.test/album.jpg',
                briefDesc: 'Album biography',
                artist: { id: 9, name: 'Artist' },
                size: 10,
            },
            songs: [],
        } as any);

        await expect(neteaseProvider.catalog!.getArtistDetail!(9)).resolves.toMatchObject({
            description: 'Artist biography',
        });
        await expect(neteaseProvider.catalog!.getAlbumDetail!(7)).resolves.toMatchObject({
            description: 'Album biography',
            artists: [{ id: 9, name: 'Artist' }],
        });
    });

    it('maps personalized playlist copywriter into the unified description field', async () => {
        vi.mocked(neteaseApi.getPersonalizedPlaylists).mockResolvedValue({
            result: [{
                id: 7,
                name: 'Recommended Playlist',
                picUrl: 'https://example.test/playlist.jpg',
                copywriter: '猜你喜欢的歌单',
            }],
        } as any);

        const collections = await neteaseProvider.recommendations!.getRecommendedCollections!(10);
        expect(collections[0]).toMatchObject({
            name: 'Recommended Playlist',
            description: '猜你喜欢的歌单',
        });
    });

    it('rejects with a network OmniError when the song URL request never reached the API', async () => {
        const tagged = Object.assign(
            new Error('NetEase API request /song/url/v1 failed: fetch failed', { cause: new TypeError('fetch failed') }),
            { networkFailure: true },
        );
        vi.mocked(neteaseApi.getSongUrl).mockRejectedValue(tagged);

        await expect(neteaseProvider.playback!.getAudioSource(song, 'high')).rejects.toMatchObject({
            name: 'OnlineProviderError',
            code: 'network',
            providerId: 'netease',
            message: 'NetEase API request /song/url/v1 failed: fetch failed',
            cause: tagged,
            details: { stage: 'song-url' },
        });
    });

    it('rejects a non-JSON 5xx body as service-unavailable with the HTTP status', async () => {
        vi.mocked(neteaseApi.getSongUrl).mockRejectedValue(
            Object.assign(new Error('NetEase API /song/url/v1 returned HTTP 503 without a JSON body: (empty)'), { httpStatus: 503 }),
        );

        await expect(neteaseProvider.playback!.getAudioSource(song, 'high')).rejects.toMatchObject({
            code: 'service-unavailable',
            httpStatus: 503,
        });
    });

    it.each([
        [{ code: 200, data: [{ url: null, code: -110, fee: 1 }] }, 'membership-required'],
        [{ code: 200, data: [{ url: null, code: -110, fee: 4 }] }, 'purchase-required'],
        [{ code: 200, data: [{ url: 'http://music.test/clip.mp3', freeTrialInfo: { start: 0, end: 30 } }] }, 'preview-only'],
        [{ code: 200, data: [{ url: null, code: 404 }] }, 'not-playable'],
        [{ code: 502, msg: 'read ECONNRESET' }, 'network'],
        [{ code: 301, msg: '需要登录' }, 'auth-required'],
        [{ code: 200, data: [] }, 'invalid-response'],
    ])('rejects an unplayable song URL response %j as %s instead of returning null', async (response, code) => {
        vi.mocked(neteaseApi.getSongUrl).mockResolvedValue(response as any);

        await expect(neteaseProvider.playback!.getAudioSource(song, 'high')).rejects.toMatchObject({
            code,
            providerId: 'netease',
        });
        // 只请求一次：不做客户端音质回退。
        expect(neteaseApi.getSongUrl).toHaveBeenCalledTimes(1);
    });

    it('decides availability from the privilege itself, not from isSongMarkedUnavailable', () => {
        // L10 的 mock 只认 st === -200；新逻辑对 -300 给 unknown，对有可播档位的 -200 也给 unknown。
        expect(neteaseProvider.playback!.getAvailability!({ ...song, privilege: { st: -300 } })).toEqual({
            state: 'unknown',
            reason: 'restricted',
        });
        expect(neteaseProvider.playback!.getAvailability!({ ...song, privilege: { st: -200, pl: 320000 } })).toEqual({
            state: 'unknown',
            reason: 'restricted',
        });
        expect(neteaseProvider.playback!.getAvailability!({ ...song, privilege: { st: -200, cs: true } })).toEqual({
            state: 'unknown',
            reason: 'restricted',
        });
        expect(neteaseProvider.playback!.getAvailability!({
            ...song,
            privilege: { st: -200 },
            noCopyrightRcmd: { typeDesc: '其它版本可播' },
        })).toEqual({ state: 'unavailable', reason: 'taken-down', label: '其它版本可播' });
        expect(neteaseProvider.playback!.getAvailability!(song)).toEqual({ state: 'playable' });
    });

    it('wraps a failed replacement lookup into an OmniError', async () => {
        const unavailableSong = { ...song, privilege: { st: -200 } };
        vi.mocked(neteaseApi.getUnavailableSongReplacement).mockRejectedValueOnce(
            Object.assign(new Error('NetEase API request /song/copyright/rcmd failed: fetch failed'), { networkFailure: true }),
        );
        await expect(neteaseProvider.playback!.getReplacement!(unavailableSong)).rejects.toMatchObject({
            name: 'OnlineProviderError',
            code: 'network',
            providerId: 'netease',
            details: { stage: 'replacement' },
        });

        const omniError = new OnlineProviderError('timeout', 'NetEase upstream request failed', 'netease');
        vi.mocked(neteaseApi.getUnavailableSongReplacement).mockRejectedValueOnce(omniError);
        await expect(neteaseProvider.playback!.getReplacement!(unavailableSong)).rejects.toBe(omniError);
    });

    it('owns unavailable status and replacement normalization inside the provider', async () => {
        const unavailableSong = { ...song, privilege: { st: -200 } };
        expect(neteaseProvider.playback!.getAvailability!(unavailableSong)).toMatchObject({
            state: 'unavailable',
        });

        vi.mocked(neteaseApi.getUnavailableSongReplacement).mockResolvedValue({
            replacementSong: { ...song, id: 43 },
            replacementSongId: 43,
            typeDesc: '版权替代版本',
        } as any);
        await expect(neteaseProvider.playback!.getReplacement!(unavailableSong)).resolves.toMatchObject({
            label: '版权替代版本',
            song: { id: 43, sourceRef: { providerId: 'netease', mediaId: '43' } },
        });
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

    it('keeps the backend code and message on an unmapped QR response', async () => {
        vi.mocked(neteaseApi.checkQr).mockResolvedValue({ code: 8821, message: '需要行为验证码验证' } as any);
        await expect(neteaseProvider.auth!.checkQr!('key')).resolves.toEqual({
            state: 'error',
            message: 'code 8821: 需要行为验证码验证',
            detail: { code: 8821, message: '需要行为验证码验证' },
        });
    });

    it.each(['read ECONNRESET', 'socket hang up', 'Client network socket disconnected before secure TLS connection was established'])(
        'marks a QR poll the upstream reset (%s) as a transient connection-reset',
        async msg => {
            vi.mocked(neteaseApi.checkQr).mockResolvedValue({ code: 502, msg } as any);
            await expect(neteaseProvider.auth!.checkQr!('key')).resolves.toEqual({
                state: 'error', message: `code 502: ${msg}`, reason: 'connection-reset', transient: true, detail: { code: 502, message: msg },
            });
        },
    );

    it('marks other network failures as transient and keeps their text as written', async () => {
        vi.mocked(neteaseApi.checkQr).mockResolvedValue({ code: 502, msg: 'connect ECONNREFUSED 127.0.0.1:7890' } as any);
        await expect(neteaseProvider.auth!.checkQr!('key')).resolves.toEqual({
            state: 'error',
            message: 'code 502: connect ECONNREFUSED 127.0.0.1:7890',
            transient: true,
            detail: { code: 502, message: 'connect ECONNREFUSED 127.0.0.1:7890' },
        });
    });

    it('throws instead of handing out an empty QR key, carrying the backend response', async () => {
        vi.mocked(neteaseApi.getQrKey).mockResolvedValue({ code: 200, data: { unikey: 'k1' } } as any);
        await expect(neteaseProvider.auth!.getQrKey!()).resolves.toBe('k1');

        const reset = { code: 502, msg: 'read ECONNRESET' };
        vi.mocked(neteaseApi.getQrKey).mockResolvedValue(reset as any);
        await expect(neteaseProvider.auth!.getQrKey!()).rejects.toMatchObject({
            code: 'invalid-response',
            message: 'NetEase QR key request failed: code 502: read ECONNRESET',
            qrLoginReason: 'connection-reset',
            transient: true,
            cause: reset,
        });

        vi.mocked(neteaseApi.getQrKey).mockResolvedValue({ code: 502, msg: 'connect ETIMEDOUT 59.111.181.35:443' } as any);
        const error = await neteaseProvider.auth!.getQrKey!().catch((caught: unknown) => caught);
        expect(error).toMatchObject({ code: 'invalid-response', message: 'NetEase QR key request failed: code 502: connect ETIMEDOUT 59.111.181.35:443' });
        expect(error).not.toHaveProperty('qrLoginReason');
    });

    it('fails instead of handing out an empty QR image', async () => {
        vi.mocked(neteaseApi.createQr).mockResolvedValue({ code: 200, data: { qrimg: 'data:image/png;base64,AAAA' } } as any);
        await expect(neteaseProvider.auth!.createQr!('k1')).resolves.toBe('data:image/png;base64,AAAA');

        vi.mocked(neteaseApi.createQr).mockResolvedValue({ code: 400, msg: 'key is required' } as any);
        await expect(neteaseProvider.auth!.createQr!('k1')).rejects.toMatchObject({
            code: 'invalid-response',
            message: 'NetEase QR image request failed: code 400: key is required',
        });
    });
});

// 网易云 `/user/playlist` 的「我喜欢的音乐」是 `specialType: 5`（数字）；首页特殊集合靠 isLiked 认它。
describe('neteaseProvider user playlists', () => {
    beforeEach(() => vi.clearAllMocks());

    it('marks its own specialType 5 playlist as liked and leaves the rest alone', async () => {
        vi.mocked(neteaseApi.getUserPlaylists).mockResolvedValue({
            playlist: [
                { id: 11, name: 'amtx喜欢的音乐', specialType: 5, subscribed: false, creator: { userId: 7, nickname: 'amtx' } },
                { id: 12, name: '自建歌单', specialType: 0, subscribed: false, creator: { userId: 7, nickname: 'amtx' } },
                // 收藏来的别人的「喜欢的音乐」也是 5：不能当成自己的（移除会变成取消自己的喜欢）。
                { id: 13, name: '别人喜欢的音乐', specialType: 5, subscribed: true, creator: { userId: 8, nickname: 'other' } },
            ],
        } as any);

        const page = await neteaseProvider.library!.getUserPlaylists!(7, 30, 0);

        expect(neteaseApi.getUserPlaylists).toHaveBeenCalledWith(7, 30, 0);
        expect(page.items.map(item => [item.id, item.isLiked])).toEqual([[11, true], [12, undefined], [13, undefined]]);
        // 归一化结果进缓存后回灌（omni.normalizeCachedCollection）仍是「我喜欢的音乐」。
        expect(neteaseProvider.normalizeCollection!(page.items[0]).isLiked).toBe(true);
        expect(neteaseProvider.normalizeCollection!(page.items[1]).isLiked).toBeUndefined();
    });
});

describe('neteaseProvider smartbox suggestions', () => {
    beforeEach(() => vi.clearAllMocks());

    it('turns song and artist suggest groups into suggestions with a playable song', async () => {
        vi.mocked(neteaseApi.getSearchSuggest).mockResolvedValue({
            result: {
                order: ['songs', 'artists'],
                songs: [{ id: 42, name: '晴天', artists: [{ id: 1, name: '周杰伦' }], album: { id: 2, name: '叶惠美' }, duration: 269000 }],
                artists: [{ id: 9, name: '周杰伦' }],
                albums: [{ id: 3, name: '叶惠美' }],
                playlists: [],
            },
        } as any);

        const suggestions = await neteaseProvider.search!.getSmartboxSuggestions!('晴天');

        expect(suggestions).toHaveLength(2);
        expect(suggestions[0]).toMatchObject({
            kind: 'song',
            value: '晴天',
            detail: '周杰伦',
            song: { id: 42, sourceRef: { providerId: 'netease', mediaId: '42' } },
        });
        expect(suggestions[1]).toEqual({ kind: 'singer', value: '周杰伦' });
    });

    it('answers an empty query and a missing result body with no suggestions', async () => {
        await expect(neteaseProvider.search!.getSmartboxSuggestions!('   ')).resolves.toEqual([]);
        vi.mocked(neteaseApi.getSearchSuggest).mockResolvedValue({ code: 200 } as any);
        await expect(neteaseProvider.search!.getSmartboxSuggestions!('晴天')).resolves.toEqual([]);
    });
});

describe('neteaseProvider type-scoped collection search', () => {
    beforeEach(() => vi.clearAllMocks());

    it('merges album and playlist search rows in that order', async () => {
        vi.mocked(neteaseApi.searchByType).mockImplementation(async (_keywords, type) => ({
            result: type === 10
                ? { albums: [{ id: 7, name: 'Album', picUrl: 'https://example.test/a.jpg', artist: { id: 9, name: 'Artist' } }] }
                : { playlists: [{ id: 8, name: 'Playlist', coverImgUrl: 'https://example.test/p.jpg', trackCount: 5 }] },
        } as any));

        const page = await neteaseProvider.search!.searchCollections!('周杰伦', 10, 0);

        expect(page.items).toHaveLength(2);
        expect(page.items[0]).toMatchObject({ id: 7, type: 'album' });
        expect(page.items[1]).toMatchObject({ id: 8, type: 'playlist', trackCount: 5 });
        expect(page).toMatchObject({ hasMore: false, nextOffset: 2 });
        expect(neteaseApi.searchByType).toHaveBeenCalledWith('周杰伦', 10, 10, 0);
        expect(neteaseApi.searchByType).toHaveBeenCalledWith('周杰伦', 1000, 10, 0);
    });

    it('skips the requests entirely for a blank query', async () => {
        const page = await neteaseProvider.search!.searchCollections!('  ', 10, 0);
        expect(page.items).toEqual([]);
        expect(neteaseApi.searchByType).not.toHaveBeenCalled();
    });
});

describe('neteaseProvider discover rows', () => {
    beforeEach(() => vi.clearAllMocks());

    it('feeds the similar row from the seed song id', async () => {
        vi.mocked(neteaseApi.getSimilarSongs).mockResolvedValue({ songs: [{ id: 5, name: 'Similar' }] } as any);
        await expect(neteaseProvider.recommendations!.getRecommendationRowSongs!('similar', { seedSongId: '42' }))
            .resolves.toMatchObject([{ id: 5, sourceRef: { providerId: 'netease', mediaId: '5' } }]);
        expect(neteaseApi.getSimilarSongs).toHaveBeenCalledWith(42, 15);
    });

    it('gives the similar row nothing without a seed', async () => {
        await expect(neteaseProvider.recommendations!.getRecommendationRowSongs!('similar', {})).resolves.toEqual([]);
        expect(neteaseApi.getSimilarSongs).not.toHaveBeenCalled();
    });

    it('maps the radar row to taste-based daily recommendations', async () => {
        vi.mocked(neteaseApi.getDailyRecommendedSongs).mockResolvedValue({ songs: [{ id: 6, name: 'Radar' }] } as any);
        await expect(neteaseProvider.recommendations!.getRecommendationRowSongs!('radar'))
            .resolves.toMatchObject([{ id: 6 }]);
        expect(neteaseApi.getDailyRecommendedSongs).toHaveBeenCalledWith(false);
    });

    it('maps the new-songs row to the personalized new-song express', async () => {
        vi.mocked(neteaseApi.getPersonalizedNewSongs).mockResolvedValue({ songs: [{ id: 7, name: 'New' }] } as any);
        await expect(neteaseProvider.recommendations!.getRecommendationRowSongs!('new-songs', { limit: 8 }))
            .resolves.toMatchObject([{ id: 7 }]);
        expect(neteaseApi.getPersonalizedNewSongs).toHaveBeenCalledWith(8);
    });

    it('answers unknown sections with an empty list', async () => {
        await expect(neteaseProvider.recommendations!.getRecommendationRowSongs!('mystery')).resolves.toEqual([]);
    });

    it('returns normalized similar songs through the standalone method', async () => {
        vi.mocked(neteaseApi.getSimilarSongs).mockResolvedValue({ songs: [{ id: 5, name: 'Similar' }] } as any);
        await expect(neteaseProvider.recommendations!.getSimilarSongs!('42', 10)).resolves.toMatchObject([{ id: 5 }]);
    });
});

describe('neteaseProvider plaza paging', () => {
    beforeEach(() => vi.clearAllMocks());

    it('serves the editorial scope from top playlists with the batch offset', async () => {
        vi.mocked(neteaseApi.getTopPlaylists).mockResolvedValue({
            playlists: [{ id: 9, name: 'Top Playlist', coverImgUrl: 'https://example.test/t.jpg' }],
        } as any);

        const collections = await neteaseProvider.recommendations!.getRecommendedCollections!(35, { scope: 'editorial', from: 35 });

        expect(collections).toMatchObject([{ id: 9, type: 'playlist' }]);
        expect(neteaseApi.getTopPlaylists).toHaveBeenCalledWith(35, 35);
        expect(neteaseApi.getPersonalizedPlaylists).not.toHaveBeenCalled();
    });

    it('keeps the personalized scope on /personalized only', async () => {
        vi.mocked(neteaseApi.getPersonalizedPlaylists).mockResolvedValue({
            result: [{ id: 7, name: 'Recommended Playlist' }],
        } as any);

        const collections = await neteaseProvider.recommendations!.getRecommendedCollections!(10, { scope: 'personalized' });

        expect(collections).toMatchObject([{ id: 7 }]);
        expect(neteaseApi.getTopPlaylists).not.toHaveBeenCalled();
    });
});

describe('neteaseProvider playlist creation', () => {
    beforeEach(() => vi.clearAllMocks());

    it('normalizes the created playlist from the full playlist body', async () => {
        vi.mocked(neteaseApi.createPlaylist).mockResolvedValue({
            code: 200,
            playlist: { id: 88, name: '新建歌单', userId: 1 },
        } as any);
        await expect(neteaseProvider.mutations!.createPlaylist!('新建歌单')).resolves.toMatchObject({
            id: 88,
            name: '新建歌单',
            type: 'playlist',
        });
    });

    it('falls back to the bare id when the playlist body is absent', async () => {
        vi.mocked(neteaseApi.createPlaylist).mockResolvedValue({ code: 200, id: 89 } as any);
        await expect(neteaseProvider.mutations!.createPlaylist!('My List')).resolves.toMatchObject({ id: 89, name: 'My List' });
    });

    it('rejects a signed-out creation as auth-required', async () => {
        vi.mocked(neteaseApi.createPlaylist).mockResolvedValue({ code: 301, msg: '需要登录' } as any);
        await expect(neteaseProvider.mutations!.createPlaylist!('新建歌单')).rejects.toMatchObject({ code: 'auth-required' });
    });

    it('rejects a success code without any created id as invalid-response', async () => {
        vi.mocked(neteaseApi.createPlaylist).mockResolvedValue({ code: 200 } as any);
        await expect(neteaseProvider.mutations!.createPlaylist!('新建歌单')).rejects.toMatchObject({ code: 'invalid-response' });
    });
});

describe('neteaseProvider song comments', () => {
    beforeEach(() => vi.clearAllMocks());

    it('merges hot comments first, then normal comments, with paging', async () => {
        vi.mocked(neteaseApi.getSongComments).mockResolvedValue({
            total: 100,
            more: true,
            hotComments: [{ commentId: 1, content: '热评', likedCount: 999, user: { nickname: 'A', avatarUrl: 'http://x/a.jpg' } }],
            comments: [{ commentId: 2, content: '普通评论', likedCount: 3, user: { nickname: 'B' }, ipLocation: '北京', timeStr: '2小时前' }],
        } as any);

        const page = await neteaseProvider.comments!.getSongComments!(song, 20, 0);
        expect(page.items).toHaveLength(2);
        expect(page.items[0]).toMatchObject({ id: 1, isHot: true, likedCount: 999, avatarUrl: 'https://x/a.jpg' });
        expect(page.items[1]).toMatchObject({ id: 2, ipLocation: '北京', timeStr: '2小时前' });
        expect(page).toMatchObject({ total: 100, hasMore: true });
    });

    it('drops comments with empty content', async () => {
        vi.mocked(neteaseApi.getSongComments).mockResolvedValue({
            comments: [{ commentId: 5, content: '   ', user: { nickname: 'x' } }],
        } as any);
        const page = await neteaseProvider.comments!.getSongComments!(song, 20, 0);
        expect(page.items).toEqual([]);
    });

    // 楼中楼：神回复置顶再拼普通回复；上游翻页是 time 游标，契约 offset 对不齐 → 首页封顶。
    it('loads floor replies with best replies first and no fake pagination', async () => {
        vi.mocked(neteaseApi.getCommentFloor).mockResolvedValue({
            data: {
                bestComments: [{ commentId: 9, content: '神回复', likedCount: 88, user: { nickname: 'S' } }],
                comments: [{ commentId: 10, content: '普通回复', user: { nickname: 'T' } }],
                totalCount: 40,
                hasMore: true,
            },
        } as any);
        const page = await neteaseProvider.comments!.getCommentReplies!(song, 9, 20, 0);
        expect(neteaseApi.getCommentFloor).toHaveBeenCalledWith(expect.anything(), 9, Math.max(20, 30));
        expect(page.items.map(i => i.id)).toEqual([9, 10]);
        expect(page.items[0]).toMatchObject({ isHot: true, likedCount: 88 });
        expect(page.hasMore).toBe(false);
    });

    it('refuses offset paging on replies instead of re-asking the first page', async () => {
        const page = await neteaseProvider.comments!.getCommentReplies!(song, 9, 20, 20);
        expect(page.items).toEqual([]);
        expect(neteaseApi.getCommentFloor).not.toHaveBeenCalled();
    });

    // 点赞写操作：200 过；301/401/403 → auth-required；其余非 200 → unavailable。绝不静默装成功。
    it('likes a comment and maps upstream auth failures', async () => {
        vi.mocked(neteaseApi.likeSongComment).mockResolvedValue({ code: 200 } as any);
        await expect(neteaseProvider.comments!.likeComment!(song, 42, true)).resolves.toBeUndefined();
        expect(neteaseApi.likeSongComment).toHaveBeenCalledWith(expect.anything(), 42, true);

        vi.mocked(neteaseApi.likeSongComment).mockResolvedValue({ code: 301, msg: '需要登录' } as any);
        await expect(neteaseProvider.comments!.likeComment!(song, 42, true)).rejects.toMatchObject({ code: 'auth-required' });

        vi.mocked(neteaseApi.likeSongComment).mockResolvedValue({ code: 502 } as any);
        await expect(neteaseProvider.comments!.likeComment!(song, 42, false)).rejects.toMatchObject({ code: 'unavailable' });
    });

    it('carries the viewer liked flag when the upstream returns it', async () => {
        vi.mocked(neteaseApi.getSongComments).mockResolvedValue({
            comments: [{ commentId: 7, content: '赞过了', liked: true, user: { nickname: 'me' } }],
        } as any);
        const page = await neteaseProvider.comments!.getSongComments!(song, 20, 0);
        expect(page.items[0]).toMatchObject({ liked: true });
    });
});

describe('neteaseProvider liked song ids', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns the ids of a successful response', async () => {
        vi.mocked(neteaseApi.getLikedSongs).mockResolvedValue({ code: 200, ids: [1, 2, 3] } as any);
        await expect(neteaseProvider.library!.getLikedSongIds!(7)).resolves.toEqual([1, 2, 3]);
        expect(neteaseApi.getLikedSongs).toHaveBeenCalledWith(7);
    });

    it('keeps an empty list when the account really likes nothing', async () => {
        vi.mocked(neteaseApi.getLikedSongs).mockResolvedValue({ code: 200, ids: [] } as any);
        await expect(neteaseProvider.library!.getLikedSongIds!(7)).resolves.toEqual([]);
    });

    // An error body must not read as "likes nothing": the caller would clear every heart.
    it.each([
        ['a server error', { code: 502 }, 'unavailable'],
        ['a missing ids list', { code: 200 }, 'unavailable'],
        ['no status code', { msg: 'busy' }, 'unavailable'],
        ['a signed-out session', { code: 301 }, 'auth-required'],
    ])('rejects %s instead of answering with no likes', async (_label, response, errorCode) => {
        vi.mocked(neteaseApi.getLikedSongs).mockResolvedValue(response as any);
        await expect(neteaseProvider.library!.getLikedSongIds!(7)).rejects.toMatchObject({ code: errorCode });
    });
});

describe('neteaseProvider listening reports', () => {
    const reported: UnifiedSong = {
        ...song,
        name: '歌名',
        artists: [{ id: 7, name: '歌手 A' }, { id: 8, name: '歌手 B' }],
    };

    beforeEach(() => vi.clearAllMocks());

    it('sends the played seconds and never a source id', async () => {
        vi.mocked(neteaseApi.scrobbleV1).mockResolvedValue({ code: 200 } as any);

        await neteaseProvider.playbackReports!.reportPlayback(reported, {
            playedSeconds: 45.6,
            totalSeconds: 240,
            quality: 'high',
        });

        const params = vi.mocked(neteaseApi.scrobbleV1).mock.calls[0][0];
        expect(params).toEqual({
            id: 42,
            time: 46,
            name: '歌名',
            artist: '歌手 A, 歌手 B',
            level: 'exhigh',
            bitrate: 320,
            total: 240,
        });
        expect(params).not.toHaveProperty('sourceid');
    });

    it.each([
        ['standard', 'standard', 128],
        ['high', 'exhigh', 320],
        ['lossless', 'lossless', 999],
        ['hires', 'hires', 1999],
    ] as const)('maps %s quality to level %s', async (quality, level, bitrate) => {
        vi.mocked(neteaseApi.scrobbleV1).mockResolvedValue({ code: 200 } as any);

        await neteaseProvider.playbackReports!.reportPlayback(reported, { playedSeconds: 45, quality });

        expect(vi.mocked(neteaseApi.scrobbleV1).mock.calls[0][0]).toMatchObject({ level, bitrate });
    });

    it('rejects a report the account was not signed in for', async () => {
        vi.mocked(neteaseApi.scrobbleV1).mockResolvedValue({ code: 301 } as any);

        await expect(neteaseProvider.playbackReports!.reportPlayback(reported, { playedSeconds: 45 }))
            .rejects.toMatchObject({ code: 'auth-required' });
    });

    it('rejects a response that carries no status code at all', async () => {
        // A gateway error page, or an API build with no /scrobble/v1 route: valid JSON, no `code`.
        vi.mocked(neteaseApi.scrobbleV1).mockResolvedValue({ message: 'Not Found' } as any);

        await expect(neteaseProvider.playbackReports!.reportPlayback(reported, { playedSeconds: 45 }))
            .rejects.toMatchObject({ code: 'unavailable' });
    });

    it('rejects any other non-success code', async () => {
        vi.mocked(neteaseApi.scrobbleV1).mockResolvedValue({ code: 500 } as any);

        await expect(neteaseProvider.playbackReports!.reportPlayback(reported, { playedSeconds: 45 }))
            .rejects.toMatchObject({ code: 'unavailable' });
    });
});
