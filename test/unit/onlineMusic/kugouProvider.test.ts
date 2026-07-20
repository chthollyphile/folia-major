import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/kugouProvider.test.ts

const requestMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/onlineMusic/kugouTransport', () => ({
    getKugouTransportAvailability: () => ({ configured: false, reason: 'not-configured' }),
    requestKugou: requestMock,
}));

vi.mock('@/services/onlineMusic/providerStorage', () => ({
    readProviderSessionValue: () => 'web-session-user',
    removeProviderSessionValue: vi.fn(),
}));

import {
    kugouProvider,
    normalizeKugouSong,
    resolveKugouSongCatalogRefs,
} from '@/services/onlineMusic/kugouProvider';
import { resolveSongCatalogRef } from '@/services/onlineMusic/catalogRefs';

describe('kugouProvider', () => {
    beforeEach(() => requestMock.mockReset());

    it('normalizes Hash identity and keeps only stable provider data', () => {
        const song = normalizeKugouSong({
            FileHash: 'ab12cd',
            SongName: '测试歌曲',
            Singers: [{ id: 7, name: '歌手' }],
            AlbumID: 9,
            AlbumName: '专辑',
            Duration: 240,
            MixSongID: 42,
            ID: 88,
            unexpected: { huge: true },
        });

        expect(song.id).toBe('AB12CD');
        expect(song.durationMs).toBe(240_000);
        expect(song.sourceRef).toEqual({
            kind: 'online',
            providerId: 'kugou',
            mediaId: 'AB12CD',
            providerData: {
                hash: 'AB12CD',
                mixSongId: 42,
                catalogLookupId: 42,
                albumId: 9,
            },
        });
        expect(song.artists[0]).toMatchObject({ id: 'kugou-artist-0', name: '歌手' });
        expect(song.artists[0].catalogRef).toBeUndefined();
        expect(song.album.catalogRef).toEqual({ providerId: 'kugou', kind: 'album', id: 9 });
    });

    it('normalizes KuGou climax ranges from millisecond strings', async () => {
        requestMock.mockResolvedValue({
            status: 1,
            error_code: 0,
            data: [{
                start_time: '84170',
                end_time: '142170',
                timelength: '58000',
                hash: 'CLIMAX-HASH',
            }],
        });

        await expect(kugouProvider.lyrics?.getChorusRanges?.('climax-hash')).resolves.toEqual([{
            startTime: 84.17,
            endTime: 142.17,
        }]);
        expect(requestMock).toHaveBeenCalledWith('song_climax', { hash: 'CLIMAX-HASH' });
    });

    it('loads server-decoded KRC through the provider lyric endpoints', async () => {
        requestMock.mockImplementation(async (operation: string) => {
            if (operation === 'search_lyric') {
                return { candidates: [{ id: '274944371', accesskey: 'observed-access-key' }] };
            }
            if (operation === 'lyric') {
                return {
                    fmt: 'krc',
                    content: 'encrypted-base64-is-not-used',
                    decodeContent: '[1000,2000]<0,800,0>测<800,1200,0>试',
                };
            }
            if (operation === 'song_climax') return { data: [] };
            return {};
        });
        const song = normalizeKugouSong({
            FileHash: 'lyric-hash',
            FileName: '歌手 - 测试',
            Duration: 3,
            MixSongID: 42,
            Image: 'http://imge.kugou.com/stdmusic/{size}/cover.jpg',
        });

        const result = await kugouProvider.lyrics?.getLyrics(song);

        expect(result?.lyrics?.isWordByWord).toBe(true);
        expect(result?.lyrics?.lines[0]?.fullText).toBe('测试');
        expect(requestMock).toHaveBeenCalledWith('search_lyric', {
            hash: 'LYRIC-HASH',
            duration: 3000,
            man: 'no',
            album_audio_id: '42',
        });
        expect(requestMock).toHaveBeenCalledWith('lyric', {
            id: '274944371',
            accesskey: 'observed-access-key',
            fmt: 'krc',
            decode: true,
        });
        expect(song.album.coverUrl).toBe('https://imge.kugou.com/stdmusic/400/cover.jpg');
    });

    it('reads canonical song metadata without normalizing it a second time', () => {
        const song = normalizeKugouSong({
            FileHash: 'ab12cd',
            SongName: '测试歌曲',
            Singers: [{ author_id: 7, name: '歌手' }],
            AlbumID: 9,
            AlbumName: '专辑',
            Image: 'https://example.test/cover.jpg',
            Duration: 240,
        });

        const metadata = kugouProvider.songMetadata?.getSongMetadata(song);

        expect(metadata).toMatchObject({
            artists: [{
                id: 7,
                name: '歌手',
                catalogRef: { providerId: 'kugou', kind: 'artist', id: 7 },
            }],
            album: {
                id: 9,
                name: '专辑',
                coverUrl: 'https://example.test/cover.jpg',
                catalogRef: { providerId: 'kugou', kind: 'album', id: 9 },
            },
            durationMs: 240_000,
            coverUrl: 'https://example.test/cover.jpg',
        });
    });

    it('separates a duplicated artist prefix from the KuGou song title', () => {
        const song = normalizeKugouSong({
            FileHash: '8C2F0C043E99779C8910C78E43DBC42A',
            SongName: 'HOYO-MiX、AURORA - 挪德卡莱 Nod-Krai',
            Singers: [{ name: 'HOYO-MiX' }, { name: 'AURORA' }],
        });

        expect(song.name).toBe('挪德卡莱 Nod-Krai');
        expect(song.artists.map(artist => artist.name)).toEqual(['HOYO-MiX', 'AURORA']);
    });

    it('recovers independent artists and nested album metadata from audio_name', () => {
        const song = normalizeKugouSong({
            FileHash: '8C2F0C043E99779C8910C78E43DBC42A',
            audio_name: 'HOYO-MiX、AURORA - 挪德卡莱 Nod-Krai',
            album_info: { album_id: 164446399, name: '原神-幽暮衬映之月 Outside It Is Growing Dark' },
        });

        expect(song.name).toBe('挪德卡莱 Nod-Krai');
        expect(song.artists.map(artist => artist.name)).toEqual(['HOYO-MiX', 'AURORA']);
        expect(song.album).toMatchObject({
            id: 164446399,
            name: '原神-幽暮衬映之月 Outside It Is Growing Dark',
        });
    });

    it('uses the FileName field returned by KuGou search results as the song title', () => {
        const song = normalizeKugouSong({
            FileHash: '8C2F0C043E99779C8910C78E43DBC42A',
            FileName: 'HOYO-MiX、AURORA - 挪德卡莱 Nod-Krai',
            SingerName: 'HOYO-MiX、AURORA',
            AlbumName: '原神-幽暮衬映之月 Outside It Is Growing Dark',
        });

        expect(song.name).toBe('挪德卡莱 Nod-Krai');
        expect(song.artists.map(artist => artist.name)).toEqual(['HOYO-MiX', 'AURORA']);
        expect(song.album?.name).toBe('原神-幽暮衬映之月 Outside It Is Growing Dark');
    });

    it('requests a rendered QR image and maps login states', async () => {
        requestMock
            .mockResolvedValueOnce({ data: { base64: 'data:image/png;base64,abc' } })
            .mockResolvedValueOnce({ data: { status: 2 } })
            .mockResolvedValueOnce({ data: { status: 4, token: 'secret' } });

        await expect(kugouProvider.auth?.createQr?.('key')).resolves.toBe('data:image/png;base64,abc');
        expect(requestMock).toHaveBeenNthCalledWith(1, 'login_qr_create', { key: 'key', qrimg: true });
        await expect(kugouProvider.auth?.checkQr?.('key')).resolves.toEqual({ state: 'scanned' });
        await expect(kugouProvider.auth?.checkQr?.('key')).resolves.toEqual({ state: 'confirmed' });
    });

    it('accepts the user id returned with user details', async () => {
        requestMock.mockResolvedValue({
            data: { userid: '123', nickname: 'Kugou User', pic: 'https://example.test/avatar.jpg' },
        });

        await expect(kugouProvider.auth?.getLoginStatus()).resolves.toMatchObject({
            id: '123', nickname: 'Kugou User', avatarUrl: 'https://example.test/avatar.jpg',
        });
    });

    it('marks an account as VIP when the dedicated response has an active business product', async () => {
        requestMock
            .mockResolvedValueOnce({
                data: { userid: '123', nickname: 'Kugou User', vip_type: 0 },
            })
            .mockResolvedValueOnce({
                data: { is_vip: 0, vip_type: 0, busi_vip: [{ is_vip: 1, busi_type: 'concept' }] },
            });

        await expect(kugouProvider.auth?.getLoginStatus()).resolves.toMatchObject({
            id: '123', nickname: 'Kugou User', vipType: 1,
        });
        expect(requestMock).toHaveBeenNthCalledWith(2, 'user_vip_detail', { userid: '123' });
    });

    it('maps quality and source metadata to the song URL request', async () => {
        requestMock.mockResolvedValue({ data: { play_url: 'http://example.test/song.flac' } });
        const song = normalizeKugouSong({ FileHash: 'hash', SongName: 'Song', AlbumID: 2, album_audio_id: 3 });
        const source = await kugouProvider.playback?.getAudioSource(song, 'lossless');

        expect(requestMock).toHaveBeenCalledWith('song_url', expect.objectContaining({
            hash: 'HASH', quality: 'flac', album_id: '2', album_audio_id: '3',
        }));
        expect(source?.url).toBe('http://example.test/song.flac');
    });

    it('retries the same quality by hash when search metadata IDs return no URL', async () => {
        requestMock
            .mockResolvedValueOnce({ status: 3, fail_process: 1 })
            .mockResolvedValueOnce({ status: 1, url: ['https://example.test/song.flac'] });
        const song = normalizeKugouSong({
            FileHash: 'hash', SongName: 'Song', AlbumID: 164446399, album_audio_id: 500617606,
        });

        const source = await kugouProvider.playback?.getAudioSource(song, 'lossless');

        expect(requestMock).toHaveBeenNthCalledWith(1, 'song_url', expect.objectContaining({
            hash: 'HASH', quality: 'flac', album_id: '164446399', album_audio_id: '500617606',
        }));
        expect(requestMock).toHaveBeenNthCalledWith(2, 'song_url', expect.objectContaining({
            hash: 'HASH', quality: 'flac', album_id: '', album_audio_id: '',
        }));
        expect(source).toMatchObject({ url: 'https://example.test/song.flac', quality: 'lossless' });
    });

    it('selects one URL when KuGou returns multiple playback candidates', async () => {
        requestMock.mockResolvedValue({
            data: {
                play_url: [
                    'http://fs.example.test/primary.flac',
                    'http://fs.example.test/backup.flac',
                ],
            },
        });
        const song = normalizeKugouSong({ FileHash: 'hash', SongName: 'Song' });

        const source = await kugouProvider.playback?.getAudioSource(song, 'lossless');

        expect(source?.url).toBe('http://fs.example.test/primary.flac');
        expect(source?.url).not.toContain(',');
    });

    it('normalizes a legacy comma-joined playback URL value', async () => {
        requestMock.mockResolvedValue({
            data: {
                play_url: 'http://fs.example.test/primary.mp3,http://fs.example.test/backup.mp3',
            },
        });
        const song = normalizeKugouSong({ FileHash: 'hash', SongName: 'Song' });

        const source = await kugouProvider.playback?.getAudioSource(song, 'high');

        expect(source?.url).toBe('http://fs.example.test/primary.mp3');
    });

    it('degrades unavailable qualities in order', async () => {
        requestMock
            .mockResolvedValueOnce({ data: {} })
            .mockRejectedValueOnce(new Error('privilege required'))
            .mockResolvedValueOnce({ data: { play_url: 'https://example.test/song.mp3' } });
        const song = normalizeKugouSong({ FileHash: 'hash', SongName: 'Song' });

        const source = await kugouProvider.playback?.getAudioSource(song, 'hires');

        expect(requestMock.mock.calls.map(call => call[1].quality)).toEqual(['high', 'flac', '320']);
        expect(source).toMatchObject({ url: 'https://example.test/song.mp3', quality: 'high' });
    });

    it('hydrates canonical album and artist ids through hash-verified KRM metadata once', async () => {
        requestMock.mockResolvedValue({
            data: [{
                base: { album_audio_id: 32155307, album_id: 10729818 },
                audio_info: { hash: 'AB12CD' },
                album_info: { album_id: 10729818, album_name: 'Canonical Album' },
                authors: [{ base: { author_id: 6539, author_name: 'Canonical Artist' } }],
            }],
        });
        const song = normalizeKugouSong({
            FileHash: 'ab12cd',
            SongName: 'Song',
            SingerName: 'Canonical Artist',
            MixSongID: 32155307,
            ID: 999999,
        });

        const [first, second] = await Promise.all([
            resolveKugouSongCatalogRefs(song),
            resolveKugouSongCatalogRefs(song),
        ]);

        expect(requestMock).toHaveBeenCalledTimes(1);
        expect(requestMock).toHaveBeenCalledWith('krm_audio', {
            album_audio_id: '32155307',
            fields: 'album_info,authors.base,base,audio_info',
        });
        expect(first.album.catalogRef).toEqual({ providerId: 'kugou', kind: 'album', id: 10729818 });
        expect(first.album.name).toBe('Canonical Album');
        expect(first.album.name).toBe('Canonical Album');
        expect(first.artists[0].catalogRef).toEqual({ providerId: 'kugou', kind: 'artist', id: 6539 });
        expect(second.album.catalogRef).toEqual(first.album.catalogRef);
    });

    it('does not let an unverified song album id short-circuit panel catalog navigation', async () => {
        requestMock.mockResolvedValue({
            data: [{
                audio_info: { hash: 'AB12CD' },
                album_info: { album_id: 10729818, album_name: 'Canonical Album' },
                authors: [{ base: { author_id: 6539, author_name: 'Canonical Artist' } }],
            }],
        });
        const song = normalizeKugouSong({
            FileHash: 'ab12cd',
            SongName: 'Displayed Song Title',
            AlbumID: 999999,
            AlbumName: 'Displayed Song Title',
            album_audio_id: 99887766,
        });

        const ref = await resolveSongCatalogRef(song, 'album', song.album);

        expect(song.album.catalogRef).toEqual({ providerId: 'kugou', kind: 'album', id: 999999 });
        expect(requestMock).toHaveBeenCalledWith('krm_audio', {
            album_audio_id: '99887766',
            fields: 'album_info,authors.base,base,audio_info',
        });
        expect(ref).toEqual({ providerId: 'kugou', kind: 'album', id: 10729818 });
    });

    it('rejects KRM metadata belonging to a different hash', async () => {
        requestMock.mockResolvedValue({
            data: [{
                audio_info: { hash: 'DIFFERENT' },
                album_info: { album_id: 10729818, album_name: 'Wrong Album' },
                authors: [{ base: { author_id: 6539, author_name: 'Wrong Artist' } }],
            }],
        });
        const song = normalizeKugouSong({
            FileHash: 'EXPECTED', SongName: 'Song', SingerName: 'Artist', MixSongID: 999001,
        });

        const resolved = await resolveKugouSongCatalogRefs(song);

        expect(resolved.album.catalogRef).toBeUndefined();
        expect(resolved.artists[0].catalogRef).toBeUndefined();
        expect(resolved.album.name).toBe('');
    });

    it('keeps playlist catalog and mutation ids separate', async () => {
        requestMock.mockResolvedValue({
            data: {
                lists: [{
                    global_collection_id: 'collection_3_1863870844_4_0',
                    listid: 12345,
                    name: 'Playlist',
                    pic: '20251014001841327327.jpg',
                    list_ver: 7,
                    m_count: 4,
                }],
                total: 1,
            },
        });

        const page = await kugouProvider.library?.getUserPlaylists?.('user', 50, 0);

        expect(page?.items[0]).toMatchObject({
            id: 'collection_3_1863870844_4_0',
            isOwned: true,
            trackCount: 4,
            tracksUpdatedAt: expect.any(Number),
            coverUrl: 'https://c1.kgimg.com/stdmusic/400/20251014/20251014001841327327.jpg',
            providerData: { listId: 12345, globalCollectionId: 'collection_3_1863870844_4_0' },
        });
    });

    it('uses the newest liked song cover when KuGou leaves the liked playlist cover empty', async () => {
        requestMock
            .mockResolvedValueOnce({
                data: {
                    info: [{
                        type: 0,
                        source: 1,
                        listid: 2,
                        name: '我喜欢',
                        pic: '',
                        global_collection_id: 'collection_3_user_2_0',
                    }],
                },
            })
            .mockResolvedValueOnce({
                data: {
                    songs: [{
                        hash: 'ABC123',
                        name: 'Newest liked song',
                        cover: 'http://imge.kugou.com/stdmusic/{size}/20260720/newest.jpg',
                    }],
                },
            });

        const page = await kugouProvider.library?.getUserPlaylists?.('user', 50, 0);

        expect(page?.items[0]).toMatchObject({
            id: 'collection_3_user_2_0',
            name: '我喜欢',
            coverUrl: 'https://imge.kugou.com/stdmusic/400/20260720/newest.jpg',
        });
        expect(requestMock).toHaveBeenNthCalledWith(2, 'playlist_track_all', {
            id: 'collection_3_user_2_0', page: 1, pagesize: 1,
        });
    });

    it('separates mixed user playlists from favorite albums', async () => {
        const response = {
            data: {
                info: [
                    {
                        type: 0,
                        source: 1,
                        global_collection_id: 'collection_3_user_1_0',
                        listid: 1,
                        name: 'Created playlist',
                        count: 2,
                        pic: 'created.jpg',
                    },
                    {
                        type: 1,
                        source: 1,
                        global_collection_id: 'collection_3_user_2_0',
                        listid: 11,
                        name: 'Favorite playlist',
                        count: 3,
                        pic: 'favorite.jpg',
                    },
                    {
                        type: 1,
                        source: 2,
                        global_collection_id: 'collection_3_user_3_0',
                        musiclib_id: 987654,
                        name: 'Favorite album',
                        count: 12,
                    },
                ],
                list_count: 3,
                album_count: 1,
            },
        };
        requestMock.mockResolvedValue(response);

        const playlists = await kugouProvider.library?.getUserPlaylists?.('user', 50, 0);
        const albums = await kugouProvider.library?.getUserAlbums?.('user', 50, 0);

        expect(playlists?.items).toHaveLength(2);
        expect(playlists?.items).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'collection_3_user_1_0', isOwned: true, type: 'playlist' }),
            expect.objectContaining({ id: 'collection_3_user_2_0', type: 'playlist' }),
        ]));
        expect(playlists?.items.find(item => item.id === 'collection_3_user_2_0')).not.toHaveProperty('isOwned');
        expect(albums?.items).toEqual([
            expect.objectContaining({ id: 987654, name: 'Favorite album', type: 'album', trackCount: 12 }),
        ]);
        expect(requestMock).toHaveBeenNthCalledWith(1, 'user_playlist', { userid: 'user', page: 1, pagesize: 50 });
        expect(requestMock).toHaveBeenNthCalledWith(2, 'user_playlist', { userid: 'user', page: 1, pagesize: 50 });
    });

    it('only exposes owned non-liked KuGou playlists as add destinations', async () => {
        requestMock.mockResolvedValue({
            data: {
                info: [
                    {
                        type: 0,
                        source: 1,
                        global_collection_id: 'created',
                        listid: 8,
                        name: '自建歌单',
                    },
                    {
                        type: 1,
                        source: 1,
                        global_collection_id: 'collected',
                        listid: 9,
                        name: '收藏歌单',
                    },
                    {
                        type: 0,
                        source: 1,
                        global_collection_id: 'liked',
                        listid: 2,
                        name: '我喜欢',
                    },
                    {
                        type: 1,
                        source: 2,
                        global_collection_id: 'album',
                        musiclib_id: 10,
                        name: '收藏专辑',
                    },
                ],
                list_count: 4,
            },
        });

        const playlists = await kugouProvider.library?.getUserPlaylists?.('user', 50, 0);
        expect(playlists?.items).toHaveLength(3);

        const addable = playlists?.items.filter(item => kugouProvider.mutations?.canAddToPlaylist?.(item));
        expect(addable).toEqual([expect.objectContaining({ id: 'created', isOwned: true })]);
        expect(playlists?.items.find(item => item.id === 'liked')).toEqual(expect.objectContaining({ isOwned: true }));
        expect(playlists?.items.find(item => item.id === 'album')).toBeUndefined();
    });

    it('requests the user cloud with the logged-in user id and maps the cloud list payload', async () => {
        requestMock.mockResolvedValue({
            data: {
                list: [{
                    hash: '6AAA167433D31309245EC71E13AB70B7',
                    author_name: '吉野裕司',
                    name: '吉野裕司 - 食む.mp3',
                    timelen: 130533,
                }],
                list_count: 1,
            },
        });

        const page = await kugouProvider.catalog?.getCloudTracks?.(1000, 0);

        expect(page).toMatchObject({ hasMore: false, nextOffset: 1, total: 1 });
        expect(page?.items[0]).toMatchObject({
            id: '6AAA167433D31309245EC71E13AB70B7',
            name: '食む.mp3',
            durationMs: 130533,
            sourceRef: { kind: 'online', providerId: 'kugou', variant: 'cloud' },
        });
        expect(requestMock).toHaveBeenCalledWith('user_cloud', {
            userid: 'web-session-user', page: 1, pagesize: 100,
        });

        requestMock.mockResolvedValue({ data: { list: [], list_count: 1 } });
        await kugouProvider.catalog?.getCloudTracks?.(1000, 100);
        expect(requestMock).toHaveBeenLastCalledWith('user_cloud', {
            userid: 'web-session-user', page: 2, pagesize: 100,
        });
    });

    it('hydrates playlist cover and introduction from playlist detail', async () => {
        requestMock.mockResolvedValue({
            data: {
                info: [{
                    global_collection_id: 'collection_3_1863870844_4_0',
                    name: 'Playlist',
                    pic: '20251014001841327327.jpg',
                    intro: 'Playlist introduction',
                    song_count: 28,
                }],
            },
        });

        const detail = await kugouProvider.catalog?.getPlaylistDetail?.(
            'collection_3_1863870844_4_0',
            {
                providerId: 'kugou',
                id: 'collection_3_1863870844_4_0',
                name: 'Playlist',
                type: 'playlist',
                providerData: { listId: 12345 },
            },
        );

        expect(requestMock).toHaveBeenCalledWith('playlist_detail', { ids: 'collection_3_1863870844_4_0' });
        expect(detail).toMatchObject({
            coverUrl: 'https://c1.kgimg.com/stdmusic/400/20251014/20251014001841327327.jpg',
            description: 'Playlist introduction',
            trackCount: 28,
            providerData: { listId: 12345, globalCollectionId: 'collection_3_1863870844_4_0' },
        });
    });

    it('preserves album and artist metadata from KuGou playlist tracks', async () => {
        requestMock.mockResolvedValue({
            data: {
                count: 1,
                songs: [{
                    hash: '6B5DCE5832B0CC91F3CB90FECF2B5B02',
                    name: '涵の心事. - 先说谎的人 (0.8X)',
                    album_id: '58271602',
                    albuminfo: { id: 58271602, name: '涵の心事.' },
                    singerinfo: [{ id: 8893172, name: '涵の心事.' }],
                    cover: 'http://imge.kugou.com/stdmusic/{size}/cover.jpg',
                    timelen: 184344,
                }],
            },
        });

        const page = await kugouProvider.catalog?.getPlaylistTracks?.('collection_3_test', 30, 0);

        expect(page?.items[0]).toMatchObject({
            name: '先说谎的人 (0.8X)',
            artists: [{
                id: 8893172,
                name: '涵の心事.',
                catalogRef: { providerId: 'kugou', kind: 'artist', id: 8893172 },
            }],
            album: {
                id: '58271602',
                name: '涵の心事.',
                catalogRef: { providerId: 'kugou', kind: 'album', id: '58271602' },
            },
        });
    });

    it('normalizes the nested song shape returned by album catalog endpoints', async () => {
        requestMock.mockResolvedValue({
            total: 1,
            data: {
                total: 1,
                songs: [{
                    base: {
                        album_id: 10729818,
                        album_audio_id: 115304862,
                        audio_name: '小心思',
                    },
                    audio_info: { hash: 'AB96FDBB35F394DFD16FB57AADD12FEA', duration: 169012 },
                    album_info: {
                        album_name: '小心思',
                        cover: 'http://imge.kugou.com/stdmusic/{size}/cover.jpg',
                    },
                    authors: [{ author_name: '孙小佳', author_id: 748078 }],
                }],
            },
        });

        const page = await kugouProvider.catalog?.getAlbumTracks?.(10729818);
        const song = page?.items[0];

        expect(requestMock).toHaveBeenCalledWith('album_songs', {
            id: '10729818', page: 1, pagesize: 30,
        });
        expect(song).toMatchObject({
            id: 'AB96FDBB35F394DFD16FB57AADD12FEA',
            name: '小心思',
            durationMs: 169012,
            album: {
                id: 10729818,
                name: '小心思',
                coverUrl: 'https://imge.kugou.com/stdmusic/400/cover.jpg',
                catalogRef: { providerId: 'kugou', kind: 'album', id: 10729818 },
            },
            sourceRef: {
                providerData: { albumAudioId: 115304862, catalogLookupId: 115304862 },
            },
        });
        expect(song?.artists[0].catalogRef).toEqual({
            providerId: 'kugou', kind: 'artist', id: 748078,
        });
    });

    it('caps album pages at the KuGou endpoint limit and advances from the effective page size', async () => {
        requestMock.mockResolvedValue({ data: { total: 60, songs: [] } });

        await kugouProvider.catalog?.getAlbumTracks?.(10729818, 1000, 30);

        expect(requestMock).toHaveBeenCalledWith('album_songs', {
            id: '10729818', page: 2, pagesize: 30,
        });
    });

    it('fills a missing album name from the opened album collection', async () => {
        requestMock.mockResolvedValue({
            data: {
                total: 1,
                songs: [{
                    base: { album_id: 10729818, audio_name: '小心思' },
                    audio_info: { hash: 'AB96FDBB35F394DFD16FB57AADD12FEA' },
                    authors: [{ author_name: '孙小佳', author_id: 748078 }],
                }],
            },
        });

        const page = await kugouProvider.catalog?.getAlbumTracks?.(10729818, 30, 0, {
            id: 10729818,
            name: '小心思',
            type: 'album',
            providerId: 'kugou',
        });

        expect(page?.items[0].album.name).toBe('小心思');
        expect(page?.items[0].album.name).toBe('小心思');
    });

    it('uses author_id for artist detail and album catalog requests', async () => {
        requestMock
            .mockResolvedValueOnce({
                data: {
                    author_id: 6539,
                    author_name: '郁可唯',
                    sizable_avatar: 'http://img/{size}/artist.jpg',
                    song_count: 100,
                    album_count: 20,
                },
            })
            .mockResolvedValueOnce({
                total: 1,
                data: [{
                    album_id: 194920827,
                    album_name: '见幸福',
                    image: 'http://img/{size}/album.jpg',
                    authors: [{ author_id: 6539, author_name: '郁可唯' }],
                    publish_time: '2020',
                }],
            });

        const detail = await kugouProvider.catalog?.getArtistDetail?.(6539);
        const albums = await kugouProvider.catalog?.getArtistAlbums?.(6539, 50, 0);

        expect(detail).toMatchObject({
            id: 6539,
            name: '郁可唯',
            coverUrl: 'https://img/400/artist.jpg',
            providerData: { musicSize: 100, albumSize: 20 },
        });
        expect(albums?.items[0]).toMatchObject({
            id: 194920827,
            name: '见幸福',
            type: 'album',
            coverUrl: 'https://img/400/album.jpg',
            artists: [{ id: 6539, name: '郁可唯' }],
            publishedAt: Date.UTC(2020, 0, 1),
        });
        expect(requestMock).toHaveBeenNthCalledWith(2, 'artist_albums', {
            id: '6539', page: 1, pagesize: 50,
        });
    });

    it('normalizes album detail biographies through the provider boundary', async () => {
        requestMock.mockResolvedValue({
            data: [{
                album_id: 194920827,
                album_name: '见幸福',
                brief_desc: 'Album biography',
                image: 'http://img/{size}/album.jpg',
                authors: [{ author_id: 6539, author_name: '郁可唯' }],
            }],
        });

        const detail = await kugouProvider.catalog?.getAlbumDetail?.(194920827);

        expect(detail).toMatchObject({
            id: 194920827,
            name: '见幸福',
            description: 'Album biography',
            artists: [{ id: 6539, name: '郁可唯' }],
        });
        expect(requestMock).toHaveBeenCalledWith('album_detail', { id: '194920827' });
    });

    it('normalizes the actual KuGou album detail response shape', async () => {
        requestMock.mockResolvedValue({
            status: 1,
            data: [{
                intro: 'Album introduction',
                sizable_cover: 'http://imge.kugou.com/stdmusic/{size}/20251014/20251014001841327327.jpg',
                cover: '20251014001841327327.jpg',
                album_name: '原神-幽暮衬映之月 Outside It Is Growing Dark',
                album_id: '164446399',
                author_name: 'HOYO-MiX',
                authors: [{ author_id: '789658', author_name: 'HOYO-MiX' }],
            }],
        });

        const detail = await kugouProvider.catalog?.getAlbumDetail?.(164446399);

        expect(detail).toMatchObject({
            id: '164446399',
            name: '原神-幽暮衬映之月 Outside It Is Growing Dark',
            description: 'Album introduction',
            coverUrl: 'https://c1.kgimg.com/stdmusic/400/20251014/20251014001841327327.jpg',
            artists: [{ id: '789658', name: 'HOYO-MiX' }],
        });
    });

    it('maps the actual personal FM song_list response into Omni songs', async () => {
        requestMock.mockResolvedValue({
            data: {
                song_list: [{
                    hash: 'D67DAA030838F1F0E9DC11CDCDB4DB5A',
                    songname: '灰かぶり (灰姑娘)',
                    singerinfo: [{ id: '9469705', name: '十明' }],
                    album_id: '75475669',
                    time_length: 220,
                    trans_param: {
                        union_cover: 'http://imge.kugou.com/stdmusic/{size}/20230705/20230705082802161869.jpg',
                    },
                }],
            },
        });

        const [song] = await kugouProvider.recommendations?.getPersonalFm?.() || [];

        expect(song).toMatchObject({
            id: 'D67DAA030838F1F0E9DC11CDCDB4DB5A',
            name: '灰かぶり (灰姑娘)',
            artists: [{ id: '9469705', name: '十明' }],
            album: {
                id: '75475669',
                coverUrl: 'https://imge.kugou.com/stdmusic/400/20230705/20230705082802161869.jpg',
            },
            durationMs: 220_000,
        });
    });

    it('reads liked song ids from KuGou\'s built-in liked playlist', async () => {
        requestMock
            .mockResolvedValueOnce({
                data: {
                    info: [{
                        type: 0,
                        source: 1,
                        listid: 2,
                        name: '我喜欢',
                        global_collection_id: 'collection_3_user_2_0',
                    }],
                },
            })
            .mockResolvedValueOnce({
                data: {
                    songs: [
                        { hash: 'abc123', name: 'Song 1' },
                        { hash: 'def456', name: 'Song 2' },
                    ],
                },
            });

        const ids = await kugouProvider.library?.getLikedSongIds?.('user');

        expect(ids).toEqual(['ABC123', 'DEF456']);
        expect(requestMock).toHaveBeenNthCalledWith(1, 'user_playlist', {
            userid: 'user', page: 1, pagesize: 100,
        });
        expect(requestMock).toHaveBeenNthCalledWith(2, 'playlist_track_all', {
            id: 'collection_3_user_2_0', page: 1, pagesize: 100,
        });
    });

    it('uses the liked playlist mutation endpoints for online song favorites', async () => {
        requestMock
            .mockResolvedValueOnce({
                data: {
                    info: [{
                        type: 0,
                        source: 1,
                        listid: 2,
                        name: '我喜欢',
                        global_collection_id: 'collection_3_user_2_0',
                    }],
                },
            })
            .mockResolvedValueOnce({});

        const song = normalizeKugouSong({
            hash: 'abc123',
            name: 'Song 1',
            album_id: 12,
            mixsongid: 34,
        });
        await kugouProvider.mutations?.likeSong?.(song, true);

        expect(requestMock).toHaveBeenNthCalledWith(2, 'playlist_tracks_add', {
            listid: '2',
            data: 'Song 1|ABC123|12|34',
        });

        requestMock.mockReset();
        requestMock
            .mockResolvedValueOnce({
                data: {
                    info: [{
                        type: 0,
                        source: 1,
                        listid: 2,
                        name: '我喜欢',
                        global_collection_id: 'collection_3_user_2_0',
                    }],
                },
            })
            .mockResolvedValueOnce({});
        await kugouProvider.mutations?.likeSong?.(song, false);

        expect(requestMock).toHaveBeenNthCalledWith(2, 'playlist_tracks_del', {
            listid: '2', fileids: 'ABC123',
        });
    });

    it('builds virtual playlists from KuGou song recommendation cards', async () => {
        requestMock.mockImplementation(async (operation: string, params: Record<string, unknown>) => {
            if (operation === 'top_card_youth') {
                return {
                    data: {
                        song_list: [{ hash: `card-${params.card_id}`, name: `Card ${params.card_id}` }],
                    },
                };
            }
            if (operation === 'everyday_history') {
                if (params.mode === 'song') {
                    return { data: { songs: [{ hash: 'history-song', name: 'History song' }] } };
                }
                return {
                    data: {
                        info: [
                            { date: '20260720', history_name: 'RT_history_20260720' },
                            { date: '20260719', history_name: 'RT_history_20260719' },
                        ],
                    },
                };
            }
            if (operation === 'personal_fm') {
                return { data: { song_list: [{ hash: 'def456', name: 'Next FM song' }] } };
            }
            return {};
        });

        const recommended = await kugouProvider.recommendations?.getRecommendedCollections?.(35);
        const entries = await kugouProvider.recommendations?.getHistoryEntries?.();
        const dates = await kugouProvider.recommendations?.getHistoryDates?.();
        const historySongs = await kugouProvider.recommendations?.getHistorySongs?.('20260719');
        const dislikeResult = await kugouProvider.recommendations?.dislikeSong?.('ABC123');
        const firstCollection = recommended?.[0];
        const firstTracks = firstCollection
            ? await kugouProvider.catalog?.getPlaylistTracks?.(firstCollection.id, 30, 0, firstCollection)
            : undefined;

        expect(recommended).toHaveLength(6);
        expect(firstCollection).toMatchObject({
            id: 'kugou-card-3006',
            type: 'playlist',
            name: 'VIP 专属推荐',
            trackCount: 1,
            providerData: { virtualRecommendation: true, cardId: 3006 },
        });
        expect(firstTracks?.items[0].id).toBe('CARD-3006');
        expect(entries?.[0]).toMatchObject({ id: '20260720', label: 'RT_history_20260720' });
        expect(dates).toEqual(['20260720', '20260719']);
        expect(historySongs?.[0].id).toBe('HISTORY-SONG');
        expect(dislikeResult?.replacement?.id).toBe('DEF456');
        expect(requestMock.mock.calls.filter(([operation]) => operation === 'top_card_youth')).toHaveLength(6);
        expect(requestMock).toHaveBeenCalledWith('everyday_history', { mode: 'list' });
        expect(requestMock).toHaveBeenCalledWith('everyday_history', {
            mode: 'song', date: '20260719', history_name: 'RT_history_20260719',
        });
        expect(requestMock).toHaveBeenCalledWith('personal_fm', {
            action: 'garbage', hash: 'ABC123', songid: 'ABC123',
        });
    });

    it('maps youth card songs to album metadata instead of uploader metadata', async () => {
        const youthSong = {
            hash: 'feec2c114d55b5f49db3960273f237cc',
            authors: [{ author_id: '5883556', author_name: '玩音符的依舟' }],
            audio_info: {
                hash: '9041AAF5B06122B0DD126A93DA5AF5C0',
                timelength: '206654',
                trans_param: {
                    union_cover: 'http://imge.kugou.com/stdmusic/{size}/20240621/20240621175302755566.jpg',
                },
            },
            nick_name: '非酋一个-等狼尊复刻',
            user_pic: 'http://imge.kugou.com/kugouicon/165/20260617/20260617220520557679.jpg',
            ori_audio_name: '晴天的乐章',
            album_info: {
                album_name: '晴天的乐章（芙宁娜原创曲）',
                album_id: '96920808',
                sizable_cover: 'http://imge.kugou.com/stdmusic/{size}/20240621/20240621175302755566.jpg',
            },
        };
        requestMock.mockImplementation(async (operation: string) => operation === 'top_card_youth'
            ? { data: { song_list: [youthSong] } }
            : {});

        const recommended = await kugouProvider.recommendations?.getRecommendedCollections?.(30);
        const collection = recommended?.find(item => item.id === 'kugou-card-3004');
        const tracks = collection
            ? await kugouProvider.catalog?.getPlaylistTracks?.(collection.id, 30, 0, collection)
            : undefined;

        expect(collection).toMatchObject({
            name: '小众宝藏佳作',
            coverUrl: 'https://imge.kugou.com/stdmusic/400/20240621/20240621175302755566.jpg',
            trackCount: 1,
        });
        expect(tracks?.items[0]).toMatchObject({
            name: '晴天的乐章',
            artists: [{ id: '5883556', name: '玩音符的依舟' }],
            album: {
                id: '96920808',
                name: '晴天的乐章（芙宁娜原创曲）',
                coverUrl: 'https://imge.kugou.com/stdmusic/400/20240621/20240621175302755566.jpg',
            },
            durationMs: 206654,
        });
        expect(collection?.name).not.toBe(youthSong.nick_name);
        expect(collection?.coverUrl).not.toBe(youthSong.user_pic);
    });

    it('unwraps nested recommendation response envelopes', async () => {
        requestMock
            .mockResolvedValueOnce({ data: { data: { songs: [{ hash: 'abc123', name: 'Daily song' }] } } })
            .mockResolvedValueOnce({ body: { data: { result: { info: [{ hash: 'def456', name: 'FM song' }] } } } })
            .mockResolvedValue({ data: { result: { song_list: [{ hash: 'card123', name: 'Nested card song' }] } } });

        const dailySongs = await kugouProvider.recommendations?.getDailySongs?.();
        const personalFm = await kugouProvider.recommendations?.getPersonalFm?.();
        const recommended = await kugouProvider.recommendations?.getRecommendedCollections?.(35);

        expect(dailySongs?.[0].id).toBe('ABC123');
        expect(personalFm?.[0].id).toBe('DEF456');
        expect(recommended).toHaveLength(6);
        expect(recommended?.[0]).toMatchObject({ id: 'kugou-card-3006', type: 'playlist', trackCount: 1 });
    });

    it('derives playlist subscription status from the mixed user-library response', async () => {
        requestMock.mockResolvedValue({
            data: {
                info: [{
                    type: 1,
                    source: 1,
                    listid: 12,
                    global_collection_id: 'collection_3_user_12_0',
                }],
            },
        });

        await expect(kugouProvider.catalog?.getSubscriptionStatus?.('playlist', 'collection_3_user_12_0'))
            .resolves.toBe(true);
        expect(requestMock).toHaveBeenCalledWith('user_playlist', {
            userid: 'web-session-user', page: 1, pagesize: 100,
        });
    });

    it('derives album subscription status from source-2 user-library entries', async () => {
        requestMock.mockResolvedValue({
            data: {
                info: [{ type: 1, source: 2, musiclib_id: '164446399', listid: 9 }],
            },
        });

        await expect(kugouProvider.catalog?.getSubscriptionStatus?.('album', '164446399'))
            .resolves.toBe(true);
    });

    it('uses playlist add with source 2 to subscribe an album', async () => {
        requestMock
            .mockResolvedValueOnce({
                data: [{
                    album_id: '164446399',
                    album_name: '原神-幽暮衬映之月 Outside It Is Growing Dark',
                    authors: [{ author_id: '789658', author_name: 'HOYO-MiX' }],
                }],
            })
            .mockResolvedValueOnce({});

        await kugouProvider.mutations?.subscribeAlbum?.('164446399', true);

        expect(requestMock).toHaveBeenNthCalledWith(1, 'album_detail', { id: '164446399' });
        expect(requestMock).toHaveBeenNthCalledWith(2, 'playlist_add', {
            source: 2,
            name: '原神-幽暮衬映之月 Outside It Is Growing Dark',
            type: 1,
            list_create_userid: '789658',
            list_create_listid: '164446399',
        });
    });

    it('uses the matched user playlist listid to unsubscribe an album', async () => {
        requestMock
            .mockResolvedValueOnce({
                data: {
                    info: [{ type: 1, source: 2, musiclib_id: '164446399', listid: 9 }],
                },
            })
            .mockResolvedValueOnce({});

        await kugouProvider.mutations?.subscribeAlbum?.('164446399', false);

        expect(requestMock).toHaveBeenNthCalledWith(1, 'user_playlist', {
            userid: 'web-session-user', page: 1, pagesize: 100,
        });
        expect(requestMock).toHaveBeenNthCalledWith(2, 'playlist_del', { listid: '9' });
    });
});
