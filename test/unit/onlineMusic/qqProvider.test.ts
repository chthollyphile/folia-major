import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/qqProvider.test.ts

const requestMock = vi.hoisted(() => vi.fn());
const clearSessionMock = vi.hoisted(() => vi.fn());
const writeSessionValueMock = vi.hoisted(() => vi.fn());
const searchQQLyricsMock = vi.hoisted(() => vi.fn());
const fetchQQLyricsMock = vi.hoisted(() => vi.fn());
const transportState = vi.hoisted(() => ({ hasSession: true }));

vi.mock('@/services/onlineMusic/qqTransport', () => ({
    getQqTransportAvailability: () => ({ configured: true }),
    hasQqSession: () => transportState.hasSession,
    clearQqSession: clearSessionMock,
    requestQq: requestMock,
}));

vi.mock('@/services/onlineMusic/providerStorage', () => ({
    writeProviderSessionValue: writeSessionValueMock,
}));

vi.mock('@/utils/lyrics/providers/qqLyricProvider', () => ({
    searchQQLyrics: searchQQLyricsMock,
    fetchQQLyrics: fetchQQLyricsMock,
}));

import { qqProvider } from '@/services/onlineMusic/qqProvider';
import { normalizeQqCollection, normalizeQqSong, normalizeQqUser } from '@/services/onlineMusic/qqNormalize';
import { OnlineProviderError } from '@/types/onlineMusic';

// Field shape of the verified `music.search.SearchCgiService` item consumed by the existing QQ search;
// the identifiers are the public ones documented by the qq-music-api routes.
const SEARCH_ITEM = {
    id: 5105918,
    mid: '003rJSwm3TechU',
    title: '海阔天空',
    singer: [{ id: 4558, mid: '0025NhlN2yWrP4', name: 'Beyond' }],
    album: { id: 8112, mid: '0016l2F430zMux', name: '乐与怒' },
    file: { media_mid: '001MediaMidFixture' },
    interval: 326,
};

// Sanitized GetPlaylistByUin shape captured during account acceptance testing.
const PLAYLIST_ITEM = {
    tid: 7,
    dirId: 201,
    dirName: '我喜欢',
    songNum: 2,
    picUrl: 'https://img.example.test/small.jpg',
    bigpicUrl: 'https://img.example.test/big.jpg',
};

describe('qqProvider', () => {
    beforeEach(() => {
        requestMock.mockReset();
        clearSessionMock.mockReset();
        writeSessionValueMock.mockReset();
        searchQQLyricsMock.mockReset();
        fetchQQLyricsMock.mockReset();
        transportState.hasSession = true;
    });

    it('normalizes a song onto songmid identity and keeps the numeric id in provider data', () => {
        const song = normalizeQqSong(SEARCH_ITEM);

        expect(song).toMatchObject({
            id: 5105918,
            name: '海阔天空',
            qqMid: '003rJSwm3TechU',
            durationMs: 326_000,
            artists: [{ id: 4558, name: 'Beyond' }],
        });
        expect(song.album).toEqual({
            id: 8112,
            name: '乐与怒',
            coverUrl: 'https://y.gtimg.cn/music/photo_new/T002R300x300M0000016l2F430zMux.jpg?max_age=2592000',
        });
        expect(song.sourceRef).toEqual({
            kind: 'online',
            providerId: 'qq',
            mediaId: '003rJSwm3TechU',
            providerData: {
                songId: 5105918,
                songMid: '003rJSwm3TechU',
                albumMid: '0016l2F430zMux',
                mediaMid: '001MediaMidFixture',
            },
        });
    });

    it('keeps a normalized song stable when it is normalized again from cache', () => {
        const song = normalizeQqSong(SEARCH_ITEM);

        expect(normalizeQqSong(song)).toEqual(song);
    });

    it('normalizes the playlist and profile payloads, including a profile without a display name', () => {
        expect(normalizeQqCollection(PLAYLIST_ITEM)).toEqual({
            providerId: 'qq',
            id: 7,
            name: '我喜欢',
            type: 'playlist',
            coverUrl: 'https://img.example.test/big.jpg',
            trackCount: 2,
            providerData: { tid: 7, dirId: 201 },
        });
        expect(normalizeQqCollection(normalizeQqCollection(PLAYLIST_ITEM))).toEqual(normalizeQqCollection(PLAYLIST_ITEM));
        expect(normalizeQqCollection({ id: 8, title: '收藏歌单', picurl: 'https://img.example.test/fav.jpg', songnum: 3 })).toEqual({
            providerId: 'qq',
            id: 8,
            name: '收藏歌单',
            type: 'playlist',
            coverUrl: 'https://img.example.test/fav.jpg',
            trackCount: 3,
            providerData: { dissid: 8 },
        });

        expect(normalizeQqUser({ data: { profile: { musicid: 123, nickname: '我的 QQ 账号' } } })).toEqual({
            id: 123,
            nickname: '我的 QQ 账号',
        });
        // The acceptance test account answered with a profile that carries no display name at all.
        expect(normalizeQqUser({ info: {}, banner: {}, errMsg: '' })).toEqual({ id: '', nickname: '' });
    });

    it('maps every QR state translated by the backend', async () => {
        requestMock
            .mockResolvedValueOnce({ code: 801, message: 'Waiting for QR scan' })
            .mockResolvedValueOnce({ code: 802, message: 'QR code scanned' })
            .mockResolvedValueOnce({
                code: 803,
                message: 'Authorization login successful',
                cookie: 'qqmusic_session=opaque-token',
            })
            .mockResolvedValueOnce({ code: 800, message: 'QR code expired' })
            .mockResolvedValueOnce({
                code: 800,
                message: 'QR login failed',
                upstreamCode: 50006,
                retryAfterMs: 31000,
            });

        await expect(qqProvider.auth!.checkQr!('qr-key')).resolves.toEqual({ state: 'waiting' });
        await expect(qqProvider.auth!.checkQr!('qr-key')).resolves.toEqual({ state: 'scanned' });
        await expect(qqProvider.auth!.checkQr!('qr-key')).resolves.toEqual({ state: 'confirmed' });
        await expect(qqProvider.auth!.checkQr!('qr-key')).resolves.toEqual({ state: 'expired' });
        // An upstream rejection is not an expired code; the unnamed safety number stays out of the state.
        await expect(qqProvider.auth!.checkQr!('qr-key')).resolves.toEqual({
            state: 'error',
            message: 'QR login failed',
        });

        expect(requestMock).toHaveBeenCalledWith('login_qr_check', { key: 'qr-key' });
        expect(writeSessionValueMock).toHaveBeenCalledExactlyOnceWith('qq', 'cookie', 'qqmusic_session=opaque-token');
    });

    it('pages the unpaginated user playlist response locally', async () => {
        const playlist = [PLAYLIST_ITEM, { tid: 8, dirName: '收藏歌单' }, { tid: 9, dirName: '试听列表' }];
        requestMock.mockResolvedValue({ code: 200, playlist, total: 3, more: false });

        const firstPage = await qqProvider.library!.getUserPlaylists(123, 2, 0);
        expect(requestMock).toHaveBeenCalledWith('user_playlist', { uid: '123' });
        expect(firstPage.items.map(item => item.name)).toEqual(['我喜欢', '收藏歌单']);
        expect(firstPage).toMatchObject({ total: 3, hasMore: true, nextOffset: 2 });

        const secondPage = await qqProvider.library!.getUserPlaylists(123, 2, 2);
        expect(secondPage.items.map(item => item.id)).toEqual([9]);
        expect(secondPage).toMatchObject({ total: 3, hasMore: false, nextOffset: 3 });

        const pastEnd = await qqProvider.library!.getUserPlaylists(123, 2, 4);
        expect(pastEnd).toMatchObject({ items: [], hasMore: false, nextOffset: 4 });
    });

    it('omits uid when the profile did not expose an account id', async () => {
        requestMock.mockResolvedValue({ code: 200, playlist: [PLAYLIST_ITEM], total: 1, more: false });

        await qqProvider.library!.getUserPlaylists('', 50, 0);

        expect(requestMock).toHaveBeenCalledWith('user_playlist', {});
    });

    it('short-circuits the login status without a stored session', async () => {
        transportState.hasSession = false;

        await expect(qqProvider.auth!.getLoginStatus()).resolves.toBeNull();
        expect(requestMock).not.toHaveBeenCalled();
    });

    it('reads the login status and treats an expired backend session as anonymous', async () => {
        requestMock
            .mockResolvedValueOnce({ code: 200, data: { profile: { musicid: 123, nickname: '我的 QQ 账号' } } })
            .mockResolvedValueOnce({ code: 200, data: {} })
            .mockRejectedValueOnce(new OnlineProviderError('auth-required', 'QQMusicApi login required', 'qq'));

        await expect(qqProvider.auth!.getLoginStatus()).resolves.toEqual({ id: 123, nickname: '我的 QQ 账号' });
        await expect(qqProvider.auth!.getLoginStatus()).resolves.toBeNull();
        await expect(qqProvider.auth!.getLoginStatus()).resolves.toBeNull();
        expect(requestMock).toHaveBeenCalledWith('login_status');
    });

    it('propagates non-auth login status failures', async () => {
        requestMock.mockRejectedValue(new OnlineProviderError('network', 'QQMusicApi request failed: 502', 'qq'));

        await expect(qqProvider.auth!.getLoginStatus()).rejects.toMatchObject({ code: 'network' });
    });

    it('clears the local session on logout even when the backend call fails', async () => {
        requestMock.mockRejectedValue(new OnlineProviderError('network', 'QQMusicApi request failed: 502', 'qq'));

        await qqProvider.auth!.logout();

        expect(requestMock).toHaveBeenCalledWith('logout');
        expect(clearSessionMock).toHaveBeenCalledTimes(1);

        transportState.hasSession = false;
        requestMock.mockClear();
        await qqProvider.auth!.logout();
        expect(requestMock).not.toHaveBeenCalled();
        expect(clearSessionMock).toHaveBeenCalledTimes(2);
    });

    it('routes search and lyrics through the existing QQ modules', async () => {
        searchQQLyricsMock.mockResolvedValue([{
            id: 5105918,
            name: '海阔天空',
            artists: [{ id: 4558, name: 'Beyond' }],
            album: { id: 8112, name: '乐与怒' },
            durationMs: 326_000,
            qqMid: '003rJSwm3TechU',
        }]);
        fetchQQLyricsMock.mockResolvedValue({ lines: [], isWordByWord: true });

        const page = await qqProvider.search!.searchSongs('海阔天空', 20, 20);
        expect(searchQQLyricsMock).toHaveBeenCalledWith('海阔天空', 2, 20);
        expect(page).toMatchObject({ hasMore: false, nextOffset: 21 });
        expect(page.items[0]?.sourceRef).toMatchObject({ providerId: 'qq', mediaId: '003rJSwm3TechU' });

        // The lyric module needs the numeric song id, which only lives in provider data after normalization.
        const result = await qqProvider.lyrics!.getLyrics({ ...page.items[0], id: '003rJSwm3TechU' });
        expect(fetchQQLyricsMock).toHaveBeenCalledWith(expect.objectContaining({
            id: 5105918,
            qqMid: '003rJSwm3TechU',
        }));
        expect(result).toEqual({ lyrics: { lines: [], isWordByWord: true }, isPureMusic: false });
    });

    it('resolves song detail and degrades authenticated playback quality until a URL exists', async () => {
        requestMock
            .mockResolvedValueOnce({ response: { songinfo: { data: { track_info: SEARCH_ITEM } } } })
            .mockResolvedValueOnce({ data: { playUrl: { '003rJSwm3TechU': { url: '' } } } })
            .mockResolvedValueOnce({ data: { playUrl: { '003rJSwm3TechU': { url: 'https://audio.example.test/song.mp3' } } } });

        await expect(qqProvider.playback!.getSongDetail('003rJSwm3TechU')).resolves.toMatchObject({
            qqMid: '003rJSwm3TechU',
        });
        await expect(qqProvider.playback!.getAudioSource(normalizeQqSong(SEARCH_ITEM), 'lossless')).resolves.toEqual({
            url: 'https://audio.example.test/song.mp3',
            fetchedAt: expect.any(Number),
            quality: 'high',
        });
        expect(requestMock.mock.calls).toEqual([
            ['song_info', { songmid: '003rJSwm3TechU' }],
            ['music_play', { songmid: '003rJSwm3TechU', mediaId: '001MediaMidFixture', quality: 'flac' }],
            ['music_play', { songmid: '003rJSwm3TechU', mediaId: '001MediaMidFixture', quality: '320' }],
        ]);
    });

    it('loads regular playlists normally but uses the encrypted-UIN endpoint for liked songs', async () => {
        requestMock
            .mockResolvedValueOnce({
                response: { cdlist: [{ songnum: 1, total_song_num: 1, songlist: [SEARCH_ITEM] }] },
            })
            .mockResolvedValue({ code: 200, songs: [SEARCH_ITEM], total: 1, more: false });

        await expect(qqProvider.catalog!.getPlaylistTracks!(7, 50, 0)).resolves.toMatchObject({
            total: 1,
            hasMore: false,
            nextOffset: 1,
            items: [expect.objectContaining({ qqMid: '003rJSwm3TechU' })],
        });
        await expect(qqProvider.library!.getLikedSongIds!(123)).resolves.toEqual(['003rJSwm3TechU']);
        await expect(qqProvider.catalog!.getPlaylistTracks!(7, 50, 0, normalizeQqCollection(PLAYLIST_ITEM))).resolves.toMatchObject({
            total: 1,
            hasMore: false,
            nextOffset: 1,
            items: [expect.objectContaining({ qqMid: '003rJSwm3TechU' })],
        });
        expect(requestMock.mock.calls).toEqual([
            ['song_list_detail', { disstid: '7' }],
            ['user_liked_songs', { offset: 0, limit: 100 }],
            ['user_liked_songs', { offset: 0, limit: 50 }],
        ]);
    });

    it('declares the playback, catalog, and likes capabilities for the QQ provider', () => {
        expect(qqProvider.capabilities).toMatchObject({
            search: true,
            lyrics: true,
            auth: true,
            userLibrary: true,
            playlists: true,
            wordByWordLyrics: true,
            playback: true,
            likes: true,
            mutations: false,
        });
        expect(qqProvider.playback).toBeDefined();
        expect(qqProvider.catalog?.getPlaylistTracks).toBeTypeOf('function');
        expect(qqProvider.library?.getLikedSongIds).toBeTypeOf('function');
        expect(qqProvider.getAvailability?.()).toEqual({ configured: true });
    });
});
