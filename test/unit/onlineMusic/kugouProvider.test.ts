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
                }],
                total: 1,
            },
        });

        const page = await kugouProvider.library?.getUserPlaylists?.('user', 50, 0);

        expect(page?.items[0]).toMatchObject({
            id: 'collection_3_1863870844_4_0',
            isOwned: true,
            coverUrl: 'https://imge.kugou.com/soft/collection/400/20251014/20251014001841327327.jpg',
            providerData: { listId: 12345, globalCollectionId: 'collection_3_1863870844_4_0' },
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
            coverUrl: 'https://imge.kugou.com/soft/collection/400/20251014/20251014001841327327.jpg',
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
});
