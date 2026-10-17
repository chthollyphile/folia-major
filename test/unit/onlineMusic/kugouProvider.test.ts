import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/kugouProvider.test.ts

const requestMock = vi.hoisted(() => vi.fn());
const anonymousSearchMock = vi.hoisted(() => vi.fn());
const legacyPlayInfoMock = vi.hoisted(() => vi.fn());
const transportState = vi.hoisted(() => ({ hasAuthenticatedSearchSession: true }));

vi.mock('@/services/onlineMusic/kugou/kugouTransport', async importOriginal => ({
    ...await importOriginal<typeof import('@/services/onlineMusic/kugou/kugouTransport')>(),
    getKugouTransportAvailability: () => ({ configured: false, reason: 'not-configured' }),
    hasKugouAuthenticatedSearchSession: () => transportState.hasAuthenticatedSearchSession,
    requestKugouAnonymousSearch: anonymousSearchMock,
    requestKugou: requestMock,
    requestKugouLegacyPlayInfo: legacyPlayInfoMock,
}));

const sessionState = vi.hoisted(() => ({ userId: 'web-session-user' }));

vi.mock('@/services/onlineMusic/providerStorage', () => ({
    readProviderSessionValue: () => sessionState.userId,
    removeProviderSessionValue: vi.fn(),
}));

import {
    kugouProvider,
    normalizeKugouSong,
    resolveKugouSongCatalogRefs,
} from '@/services/onlineMusic/kugou/kugouProvider';
import { resolveSongCatalogRef } from '@/services/onlineMusic/catalogRefs';
import { KUGOU_API_BASE_MISSING } from '@/services/onlineMusic/kugou/kugouTransport';
import { OnlineProviderError } from '@/types/onlineMusic';

describe('kugouProvider', () => {
    beforeEach(async () => {
        // provider 里的"我喜欢"歌单引用和行号缓存是模块级的，按会话生命周期清理；用例之间必须先登出，
        // 否则上一条用例写进去的引用会让下一条跳过 user_playlist 请求。
        requestMock.mockReset();
        requestMock.mockResolvedValue(undefined);
        await kugouProvider.auth?.logout?.();

        sessionState.userId = 'web-session-user';
        vi.useRealTimers();
        requestMock.mockReset();
        anonymousSearchMock.mockReset();
        legacyPlayInfoMock.mockReset();
        transportState.hasAuthenticatedSearchSession = true;
    });

    it('uses anonymous signed search when no authenticated KuGou session exists', async () => {
        transportState.hasAuthenticatedSearchSession = false;
        anonymousSearchMock.mockResolvedValue({
            data: {
                lists: [
                    {
                        FileHash: 'anonymous-hash',
                        SongName: '爱河',
                        Singers: [{ id: 7, name: '神马乐团' }],
                        Duration: 226,
                    },
                    {
                        FileHash: 'anonymous-hash',
                        SongName: '爱河（重复结果）',
                        Singers: [{ id: 7, name: '神马乐团' }],
                        Duration: 226,
                    },
                ],
            },
        });

        const page = await kugouProvider.search!.searchSongs('爱河', 50, 0);

        expect(anonymousSearchMock).toHaveBeenCalledWith('爱河', 1, 50);
        expect(requestMock).not.toHaveBeenCalled();
        expect(page.items[0]).toMatchObject({
            id: 'ANONYMOUS-HASH',
            name: '爱河',
            durationMs: 226_000,
        });
        expect(page.items).toHaveLength(1);
        expect(page.nextOffset).toBe(2);
    });

    it('keeps authenticated searches on the provider transport', async () => {
        requestMock.mockResolvedValue({
            data: {
                lists: [{
                    FileHash: 'authenticated-hash',
                    SongName: '爱河',
                    Singers: [{ id: 7, name: '神马乐团' }],
                    Duration: 226,
                }],
            },
        });

        const page = await kugouProvider.search!.searchSongs('爱河', 50, 0);

        expect(requestMock).toHaveBeenCalledWith('search', {
            keywords: '爱河',
            keyword: '爱河',
            type: 'song',
            page: 1,
            pagesize: 50,
        });
        expect(anonymousSearchMock).not.toHaveBeenCalled();
        expect(page.items[0]?.id).toBe('AUTHENTICATED-HASH');
    });

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

    it('keeps a high-resolution canonical KuGou cover for templates and sized CDN URLs', () => {
        const templateSong = normalizeKugouSong({
            FileHash: 'template-cover',
            Image: 'http://imge.kugou.com/stdmusic/{size}/20251014/cover.jpg',
        });
        const sizedSong = normalizeKugouSong({
            FileHash: 'sized-cover',
            Image: 'https://c1.kgimg.com/stdmusic/400/20251014/cover.jpg',
        });

        expect(templateSong.album.coverUrl)
            .toBe('https://imge.kugou.com/stdmusic/1024/20251014/cover.jpg');
        expect(sizedSong.album.coverUrl)
            .toBe('https://c1.kgimg.com/stdmusic/1024/20251014/cover.jpg');
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
        expect(song.album.coverUrl).toBe('https://imge.kugou.com/stdmusic/1024/cover.jpg');
    });

    it('rejects non-empty KRC payloads that contain no lyric lines', async () => {
        requestMock.mockImplementation(async (operation: string) => {
            if (operation === 'search_lyric') {
                return { candidates: [{ id: 'metadata-only', accesskey: 'observed-access-key' }] };
            }
            if (operation === 'lyric') {
                return { decodeContent: '[id:metadata-only]\n[ar:Artist]\n[ti:Song]' };
            }
            return {};
        });
        const song = normalizeKugouSong({
            FileHash: 'empty-lyric-hash',
            FileName: 'Artist - Song',
            Duration: 180,
        });

        const result = await kugouProvider.lyrics?.getLyrics(song);

        expect(result?.lyrics).toBeNull();
        expect(result?.isPureMusic).toBe(false);
        expect(requestMock).not.toHaveBeenCalledWith('song_climax', expect.anything());
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
        await expect(kugouProvider.auth?.checkLogin?.('key')).resolves.toEqual({ state: 'scanned' });
        await expect(kugouProvider.auth?.checkLogin?.('key')).resolves.toEqual({ state: 'confirmed' });
    });

    it('accepts the user id returned with user details', async () => {
        requestMock.mockResolvedValue({
            data: { userid: '123', nickname: 'Kugou User', pic: 'https://example.test/avatar.jpg', is_vip: 1 },
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
                data: { is_vip: 1 },
            })
            .mockResolvedValueOnce({
                data: { is_vip: 0, vip_type: 0, busi_vip: [{ is_vip: 1, busi_type: 'concept' }] },
            });

        await expect(kugouProvider.auth?.getLoginStatus()).resolves.toMatchObject({
            id: '123', nickname: 'Kugou User', vipType: 1,
        });
        expect(requestMock).toHaveBeenNthCalledWith(2, 'youth_union_vip', expect.objectContaining({ userid: '123' }));
        expect(requestMock).toHaveBeenNthCalledWith(3, 'user_vip_detail', { userid: '123' });
    });

    it('claims and upgrades daily VIP with the current China calendar date', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-29T16:30:00Z'));
        requestMock
            .mockResolvedValueOnce({
                data: { userid: '123', nickname: 'Kugou User', vip_type: 0 },
            })
            .mockResolvedValueOnce({
                data: { is_vip: 0 },
            })
            .mockResolvedValueOnce({
                data: { status: 1, msg: 'success' },
            })
            .mockResolvedValueOnce({
                status: 1, error_code: 0, data: { recharge_hours: 24 },
            })
            .mockResolvedValueOnce({
                data: { is_vip: 0, vip_type: 0, busi_vip: [{ is_vip: 1, busi_type: 'concept' }] },
            });

        await expect(kugouProvider.auth?.getLoginStatus()).resolves.toMatchObject({
            id: '123', nickname: 'Kugou User', vipType: 1,
        });
        expect(requestMock).toHaveBeenNthCalledWith(2, 'youth_union_vip', expect.objectContaining({ userid: '123' }));
        expect(requestMock).toHaveBeenNthCalledWith(3, 'youth_day_vip', expect.objectContaining({
            userid: '123', receive_day: '2026-07-30',
        }));
        expect(requestMock).toHaveBeenNthCalledWith(4, 'youth_day_vip_upgrade', expect.objectContaining({ userid: '123' }));
        expect(requestMock).toHaveBeenNthCalledWith(5, 'user_vip_detail', { userid: '123' });
    });

    it('does not upgrade or report daily VIP when the claim response fails', async () => {
        requestMock
            .mockResolvedValueOnce({
                data: { userid: '123', nickname: 'Kugou User', vip_type: 0 },
            })
            .mockResolvedValueOnce({
                data: { is_vip: 0 },
            })
            .mockResolvedValueOnce({
                status: 0, error_code: 500, error_msg: 'claim failed',
            })
            .mockResolvedValueOnce({
                data: { is_vip: 0, vip_type: 0 },
            });

        await expect(kugouProvider.auth?.getLoginStatus()).resolves.toMatchObject({
            id: '123', nickname: 'Kugou User', vipType: 0,
        });
        expect(requestMock).not.toHaveBeenCalledWith('youth_day_vip_upgrade', expect.anything());
        expect(requestMock).toHaveBeenNthCalledWith(4, 'user_vip_detail', { userid: '123' });
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

    it('maps top-level KuGou ReplayGain fields and converts peak dB to a linear ratio', async () => {
        requestMock.mockResolvedValue({
            status: 1,
            url: [
                'https://fs.example.test/primary.flac',
                'https://fs.example.test/backup.flac',
            ],
            volume: -12.1,
            volume_peak: -0.4,
            volume_gain: 0,
        });
        const song = normalizeKugouSong({ FileHash: 'hash', SongName: 'Song' });

        const source = await kugouProvider.playback?.getAudioSource(song, 'lossless');

        expect(source).toMatchObject({
            url: 'https://fs.example.test/primary.flac',
            replayGain: {
                trackGain: -12.1,
                trackPeak: Math.pow(10, -0.4 / 20),
            },
        });
        expect(source?.replayGain).not.toHaveProperty('volumeGain');
    });

    it('maps ReplayGain fields when KuGou wraps the URL in a data array', async () => {
        requestMock.mockResolvedValue({
            data: [{
                url: ['https://fs.example.test/song.flac'],
                volume: '-6.5',
                volume_peak: '-1.2',
                volume_gain: 0,
            }],
        });
        const song = normalizeKugouSong({ FileHash: 'hash', SongName: 'Song' });

        const source = await kugouProvider.playback?.getAudioSource(song, 'high');

        expect(source?.replayGain).toEqual({
            trackGain: -6.5,
            trackPeak: Math.pow(10, -1.2 / 20),
        });
    });

    it('keeps ReplayGain mapping for KuGou cloud playback responses', async () => {
        requestMock.mockResolvedValue({
            data: {
                url: ['https://fs.example.test/cloud.flac'],
                volume: -4.2,
                volume_peak: -0.8,
            },
        });
        const song = {
            ...normalizeKugouSong({ FileHash: 'hash', SongName: 'Song' }),
            sourceRef: {
                kind: 'online' as const,
                providerId: 'kugou' as const,
                mediaId: 'HASH',
                variant: 'cloud' as const,
                providerData: { hash: 'HASH', fileId: 'cloud-file' },
            },
        };

        const source = await kugouProvider.playback?.getAudioSource(song, 'high');

        expect(requestMock).toHaveBeenCalledWith('user_cloud_url', expect.objectContaining({ hash: 'HASH' }));
        expect(source?.replayGain).toEqual({
            trackGain: -4.2,
            trackPeak: Math.pow(10, -0.8 / 20),
        });
    });

    it('maps ReplayGain fields from a bare KuGou response array', async () => {
        requestMock.mockResolvedValue([{
            url: 'https://fs.example.test/array.flac',
            volume: -2.4,
            volume_peak: '-0.6',
        }]);
        const song = normalizeKugouSong({ FileHash: 'hash', SongName: 'Song' });

        const source = await kugouProvider.playback?.getAudioSource(song, 'high');

        expect(source?.replayGain).toEqual({
            trackGain: -2.4,
            trackPeak: Math.pow(10, -0.6 / 20),
        });
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
            .mockResolvedValueOnce({
                data: {
                    play_url: 'https://example.test/song.mp3',
                    volume: -5.5,
                    volume_peak: -1.1,
                    volume_gain: 0,
                },
            });
        const song = normalizeKugouSong({ FileHash: 'hash', SongName: 'Song' });

        const source = await kugouProvider.playback?.getAudioSource(song, 'hires');

        expect(requestMock.mock.calls.map(call => call[1].quality)).toEqual(['high', 'flac', '320']);
        expect(source).toMatchObject({
            url: 'https://example.test/song.mp3',
            quality: 'high',
            replayGain: {
                trackGain: -5.5,
                trackPeak: Math.pow(10, -1.1 / 20),
            },
        });
    });

    it('uses the legacy mobile playInfo URL when all /song/url variants fail', async () => {
        requestMock.mockResolvedValue({ status: 3 });
        legacyPlayInfoMock.mockResolvedValue({
            status: 1,
            url: 'https://legacy.example.test/song.mp3',
            backup_url: 'https://legacy.example.test/backup.mp3',
        });
        const song = normalizeKugouSong({
            FileHash: 'hash', SongName: 'Song', AlbumID: 164446399, album_audio_id: 500617606,
        });

        const source = await kugouProvider.playback?.getAudioSource(song, 'lossless');

        expect(legacyPlayInfoMock).toHaveBeenCalledWith('HASH');
        expect(source).toMatchObject({
            url: 'https://legacy.example.test/song.mp3',
            quality: 'standard',
        });
    });

    it('uses the legacy mobile playInfo backup_url when url is absent', async () => {
        requestMock.mockResolvedValue({ data: {} });
        legacyPlayInfoMock.mockResolvedValue({
            status: 1,
            backup_url: 'https://legacy.example.test/backup.mp3',
        });
        const song = normalizeKugouSong({ FileHash: 'hash', SongName: 'Song' });

        const source = await kugouProvider.playback?.getAudioSource(song, 'high');

        expect(legacyPlayInfoMock).toHaveBeenCalledWith('HASH');
        expect(source?.url).toBe('https://legacy.example.test/backup.mp3');
    });

    it('says KuGou gave no URL, with the last answer\'s status, when the legacy mobile playInfo has none either', async () => {
        requestMock.mockResolvedValue({ status: 3 });
        legacyPlayInfoMock.mockResolvedValue({ status: 3 });
        const song = normalizeKugouSong({ FileHash: 'hash', SongName: 'Song' });

        const failure = await kugouProvider.playback!.getAudioSource(song, 'standard').catch((thrown: unknown) => thrown);

        expect(legacyPlayInfoMock).toHaveBeenCalledWith('HASH');
        expect(failure).toMatchObject({ code: 'not-playable', providerId: 'kugou', cause: { status: 3 } });
        expect(kugouProvider.describeFailure?.('audio', failure)).toEqual({ case: 'no-audio', code: '3' });
    });

    // Which error getAudioSource throws when no URL comes; what it means is said in kugouFailure.ts.
    describe('getAudioSource failure', () => {
        const networkError = () => new OnlineProviderError('network', 'KuGou request failed (operation=song_url)', 'kugou');
        // The bridge's line for a request that ran out of time (electron/kugou/kugouApiBridge.cjs).
        const timeoutError = () => new OnlineProviderError(
            'network',
            'KuGou request failed (operation=song_url): ETIMEDOUT: connect ETIMEDOUT 1.2.3.4:443',
            'kugou',
            new Error("Error invoking remote method 'kugou-api-request': KuGouApiError: KuGouApi[operation=song_url]: ETIMEDOUT: connect ETIMEDOUT 1.2.3.4:443"),
        );
        const authError = () => new OnlineProviderError(
            'auth-required',
            'KuGou login required (operation=song_url status=502 error_code=152)',
            'kugou',
        );
        const metadataSong = () => normalizeKugouSong({
            FileHash: 'hash', SongName: 'Song', AlbumID: 164446399, album_audio_id: 500617606,
        });
        const plainSong = () => normalizeKugouSong({ FileHash: 'hash', SongName: 'Song' });

        it('asks every level and variant, then the legacy endpoint, and says no URL with KuGou\'s status', async () => {
            requestMock.mockResolvedValue({ status: 3, errcode: 0 });
            legacyPlayInfoMock.mockResolvedValue({ status: 0 });

            const error = await kugouProvider.playback!.getAudioSource(metadataSong(), 'high').catch(caught => caught);

            expect(requestMock).toHaveBeenCalledTimes(4);
            expect(legacyPlayInfoMock).toHaveBeenCalledTimes(1);
            // errcode 0 is KuGou saying no error: the status is the code quoted.
            expect(kugouProvider.describeFailure?.('audio', error)).toEqual({ case: 'no-audio', code: '3' });
        });

        it('says signing in may help when no URL came and no account is signed in, also past a legacy HTTP error', async () => {
            transportState.hasAuthenticatedSearchSession = false;
            requestMock.mockResolvedValue({ status: 3 });
            legacyPlayInfoMock.mockRejectedValue(new OnlineProviderError('network', 'KuGou legacy playInfo failed: 403', 'kugou', undefined, 403));

            const error = await kugouProvider.playback!.getAudioSource(plainSong(), 'standard').catch(caught => caught);

            expect(kugouProvider.describeFailure?.('audio', error)).toEqual({ case: 'no-audio', code: '3', likelyCause: 'sign-in' });
        });

        it('throws the first request that failed where no answer came, without a sign-in hint', async () => {
            transportState.hasAuthenticatedSearchSession = false;
            const first = networkError();
            requestMock.mockRejectedValueOnce(first).mockRejectedValue(networkError());
            legacyPlayInfoMock.mockRejectedValue(networkError());

            await expect(kugouProvider.playback!.getAudioSource(plainSong(), 'lossless')).rejects.toBe(first);
            expect(requestMock).toHaveBeenCalledTimes(3);
        });

        // KuGou's own answer says more than a request that failed after it.
        it('says no URL where an answer without one came before requests that failed', async () => {
            requestMock.mockResolvedValueOnce({ status: 3 }).mockRejectedValue(networkError());
            legacyPlayInfoMock.mockResolvedValue({ status: 3 });

            await expect(kugouProvider.playback!.getAudioSource(plainSong(), 'lossless')).rejects.toMatchObject({ code: 'not-playable' });
            expect(requestMock).toHaveBeenCalledTimes(3);
        });

        it('stops asking /song/url after a request ran out of time, and still asks the legacy endpoint once', async () => {
            requestMock.mockRejectedValue(timeoutError());
            legacyPlayInfoMock.mockRejectedValue(networkError());

            const error = await kugouProvider.playback!.getAudioSource(metadataSong(), 'hires').catch(caught => caught);

            expect(requestMock).toHaveBeenCalledTimes(1);
            expect(legacyPlayInfoMock).toHaveBeenCalledTimes(1);
            expect(kugouProvider.describeFailure?.('audio', error)).toEqual({ case: 'unreachable' });
        });

        it.each([
            ['the web build has no KuGou address', () => new OnlineProviderError('unavailable', KUGOU_API_BASE_MISSING, 'kugou')],
            ['KuGouMusicApi asks to wait', () => new OnlineProviderError('network', 'KuGouMusicApi request failed: 429', 'kugou', undefined, 429, 25_000)],
        ])('throws after a single request where %s', async (_label, thrown) => {
            const error = thrown();
            requestMock.mockRejectedValue(error);

            await expect(kugouProvider.playback!.getAudioSource(metadataSong(), 'hires')).rejects.toBe(error);
            expect(requestMock).toHaveBeenCalledTimes(1);
            expect(legacyPlayInfoMock).not.toHaveBeenCalled();
        });

        it('returns a lower quality after the preferred one comes back empty', async () => {
            requestMock
                .mockResolvedValueOnce({ status: 3 })
                .mockResolvedValueOnce({ data: { play_url: 'https://example.test/lossless.flac' } });

            const source = await kugouProvider.playback!.getAudioSource(plainSong(), 'hires');

            expect(requestMock.mock.calls.map(call => call[1].quality)).toEqual(['high', 'flac']);
            expect(source).toMatchObject({ url: 'https://example.test/lossless.flac', quality: 'lossless' });
            expect(legacyPlayInfoMock).not.toHaveBeenCalled();
        });

        it('never asks the legacy endpoint for a cloud song', async () => {
            requestMock.mockRejectedValue(authError());
            const song = {
                ...plainSong(),
                sourceRef: {
                    kind: 'online' as const,
                    providerId: 'kugou' as const,
                    mediaId: 'HASH',
                    variant: 'cloud' as const,
                    providerData: { hash: 'HASH', fileId: 'cloud-file' },
                },
            };

            await expect(kugouProvider.playback!.getAudioSource(song, 'high')).rejects.toMatchObject({ code: 'auth-required' });
            expect(requestMock.mock.calls.map(call => call[0])).toEqual(['user_cloud_url']);
            expect(legacyPlayInfoMock).not.toHaveBeenCalled();
        });

        it('says copyright may be the cause when KuGou refuses with err_code 30020', async () => {
            requestMock.mockResolvedValue({ status: 0, error_code: 30020 });
            legacyPlayInfoMock.mockResolvedValue({ status: 0 });
            const song = normalizeKugouSong({ FileHash: 'hash', SongName: 'Song' });

            const error = await kugouProvider.playback!.getAudioSource(song, 'standard').catch(caught => caught);

            expect(kugouProvider.describeFailure?.('audio', error)).toEqual({
                case: 'no-audio', code: '30020', likelyCause: 'copyright',
            });
        });

        it('says copyright may be the cause when KuGou marks the song small_library_song', async () => {
            requestMock.mockResolvedValue({ status: 0, error_code: 30020, small_library_song: 1 });
            legacyPlayInfoMock.mockResolvedValue({ status: 0 });
            const song = normalizeKugouSong({ FileHash: 'hash', SongName: 'Song' });

            const error = await kugouProvider.playback!.getAudioSource(song, 'standard').catch(caught => caught);

            expect(kugouProvider.describeFailure?.('audio', error)).toEqual({
                case: 'no-audio', code: '30020', likelyCause: 'copyright',
            });
        });
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
            coverUrl: 'https://c1.kgimg.com/stdmusic/1024/20251014/20251014001841327327.jpg',
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
            coverUrl: 'https://imge.kugou.com/stdmusic/1024/20260720/newest.jpg',
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
            coverUrl: 'https://c1.kgimg.com/stdmusic/1024/20251014/20251014001841327327.jpg',
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
                coverUrl: 'https://imge.kugou.com/stdmusic/1024/cover.jpg',
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
            coverUrl: 'https://img/1024/artist.jpg',
            providerData: { musicSize: 100, albumSize: 20 },
        });
        expect(albums?.items[0]).toMatchObject({
            id: 194920827,
            name: '见幸福',
            type: 'album',
            coverUrl: 'https://img/1024/album.jpg',
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
            coverUrl: 'https://imge.kugou.com/stdmusic/1024/20251014/20251014001841327327.jpg',
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
                coverUrl: 'https://imge.kugou.com/stdmusic/1024/20230705/20230705082802161869.jpg',
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

        const liked = await kugouProvider.library?.getLikedSongIds?.('user');

        expect(liked).toEqual({ ids: ['ABC123', 'DEF456'], whole: true });
        expect(requestMock).toHaveBeenNthCalledWith(1, 'user_playlist', {
            userid: 'user', page: 1, pagesize: 100,
        });
        expect(requestMock).toHaveBeenNthCalledWith(2, 'playlist_track_all', {
            id: 'collection_3_user_2_0', page: 1, pagesize: 100,
        });
    });

    it('reads every liked playlist page instead of only the first 100 songs', async () => {
        const firstPageSongs = Array.from({ length: 100 }, (_, index) => ({
            hash: `paged-${index}`,
            name: `Song ${index}`,
        }));
        requestMock
            .mockResolvedValueOnce({
                data: {
                    info: [{
                        type: 0,
                        source: 1,
                        listid: 2,
                        name: '我喜欢',
                        global_collection_id: 'collection_3_liked_test_paged',
                    }],
                },
            })
            .mockResolvedValueOnce({
                data: { count: 101, songs: firstPageSongs },
            })
            .mockResolvedValueOnce({
                data: { count: 101, songs: [{ hash: 'paged-last', name: 'Last Song' }] },
            });

        const liked = await kugouProvider.library?.getLikedSongIds?.('user');

        expect(liked?.ids).toHaveLength(101);
        expect(liked?.ids.at(-1)).toBe('PAGED-LAST');
        expect(liked?.whole).toBe(true);
        expect(requestMock).toHaveBeenNthCalledWith(2, 'playlist_track_all', {
            id: 'collection_3_liked_test_paged', page: 1, pagesize: 100,
        });
        expect(requestMock).toHaveBeenNthCalledWith(3, 'playlist_track_all', {
            id: 'collection_3_liked_test_paged', page: 2, pagesize: 100,
        });
    });

    // What the liked list and its rows answer in the tests below: one liked playlist, one song in it.
    const likedAnswers = (listid: number, collectionId: string, fileid: number) => async (endpoint: string) => (
        endpoint === 'user_playlist'
            ? { data: { info: [{ type: 0, source: 1, listid, name: '我喜欢', global_collection_id: collectionId }] } }
            : endpoint === 'playlist_track_all'
                ? { data: { count: 1, songs: [{ hash: 'abc123', name: 'Song 1', fileid }] } }
                : {}
    );
    const asked = (endpoint: string) => requestMock.mock.calls.filter(call => call[0] === endpoint).length;

    it('notes the row of each liked song it reads, and an unlike sends that row without reading the list again', async () => {
        requestMock.mockImplementation(likedAnswers(2, 'collection_3_liked_test_songs', 987));
        const liked = await kugouProvider.library?.getLikedSongIds?.('web-session-user');
        expect(liked).toEqual({ ids: ['ABC123'], whole: true });

        requestMock.mockClear();
        const song = normalizeKugouSong({ hash: 'abc123', name: 'Song 1', album_id: 12, mixsongid: 34 });
        await kugouProvider.mutations?.likeSong?.(song, false);
        expect(requestMock.mock.calls).toEqual([['playlist_tracks_del', { listid: '2', fileids: '987' }]]);

        // The row went with the unlike: the next one looks the song up in the list.
        requestMock.mockClear();
        await kugouProvider.mutations?.likeSong?.(song, false);
        expect(asked('playlist_track_all')).toBe(1);
    });

    it('notes no row for a song an unlike was sent for while the list was read, and none for a song the list no longer shows', async () => {
        const song = normalizeKugouSong({ hash: 'abc123', name: 'Song 1', album_id: 12, mixsongid: 34 });
        requestMock.mockImplementation(likedAnswers(2, 'collection_3_liked_test_rows', 987));
        await kugouProvider.library?.getLikedSongIds?.('web-session-user');

        // A second read is under way when the unlike is sent; it still shows the song at its old row.
        let answerList!: (value: unknown) => void;
        requestMock.mockImplementation(async (endpoint: string) => (
            endpoint === 'playlist_track_all' ? new Promise(resolve => { answerList = resolve; }) : likedAnswers(2, 'collection_3_liked_test_rows', 987)(endpoint)
        ));
        const read = kugouProvider.library?.getLikedSongIds?.('web-session-user');
        await vi.waitFor(() => expect(asked('playlist_track_all')).toBe(2));
        await kugouProvider.mutations?.likeSong?.(song, false);
        expect(requestMock).toHaveBeenLastCalledWith('playlist_tracks_del', { listid: '2', fileids: '987' });
        answerList({ data: { count: 1, songs: [{ hash: 'abc123', name: 'Song 1', fileid: 987 }] } });
        await read;

        // The row that read showed is not noted: once the adapter's short-lived copy of the list
        // has aged, the list is asked where the song is now.
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() + 11_000);
        requestMock.mockClear();
        requestMock.mockImplementation(likedAnswers(2, 'collection_3_liked_test_rows', 988));
        await kugouProvider.mutations?.likeSong?.(song, false);
        expect(asked('playlist_track_all')).toBe(1);
        expect(requestMock).toHaveBeenLastCalledWith('playlist_tracks_del', { listid: '2', fileids: '988' });

        // A read that shows other songs only leaves no row for this one.
        requestMock.mockImplementation(likedAnswers(2, 'collection_3_liked_test_rows', 989));
        await kugouProvider.library?.getLikedSongIds?.('web-session-user');
        requestMock.mockImplementation(async (endpoint: string) => (
            endpoint === 'playlist_track_all'
                ? { data: { count: 1, songs: [{ hash: 'def456', name: 'Song 2', fileid: 5 }] } }
                : likedAnswers(2, 'collection_3_liked_test_rows', 989)(endpoint)
        ));
        await kugouProvider.library?.getLikedSongIds?.('web-session-user');
        requestMock.mockClear();
        await kugouProvider.mutations?.likeSong?.(song, false);
        expect(requestMock).not.toHaveBeenCalledWith('playlist_tracks_del', expect.anything());
    });

    it('reads the liked songs from KuGou again when they are read twice in a row', async () => {
        const playlists = {
            data: { info: [{ type: 0, source: 1, listid: 2, name: '我喜欢', global_collection_id: 'collection_3_liked_test_twice' }] },
        };
        requestMock
            .mockResolvedValueOnce(playlists)
            .mockResolvedValueOnce({ data: { songs: [{ hash: 'abc123', name: 'Song 1' }] } })
            .mockResolvedValueOnce(playlists)
            // A song liked in KuGou's own app since the first read.
            .mockResolvedValueOnce({ data: { songs: [{ hash: 'abc123', name: 'Song 1' }, { hash: 'def456', name: 'Song 2' }] } });

        await kugouProvider.library?.getLikedSongIds?.('user');
        const liked = await kugouProvider.library?.getLikedSongIds?.('user');

        expect(liked?.ids).toEqual(['ABC123', 'DEF456']);
    });

    it('counts the liked songs by the count the list of playlists gives for the liked list, and gives none where it names none', async () => {
        requestMock.mockResolvedValueOnce({
            data: {
                info: [
                    { type: 0, source: 1, listid: 8, name: '自建歌单', count: 4 },
                    { type: 0, source: 1, listid: 2, name: '我喜欢', count: 12, global_collection_id: 'collection_3_liked_test_count' },
                ],
            },
        });
        await expect(kugouProvider.library?.getLikedSongCount?.('user')).resolves.toBe(12);
        expect(requestMock.mock.calls).toEqual([['user_playlist', { userid: 'user', page: 1, pagesize: 100 }]]);

        // The liked list without a count, and a list of playlists without the liked list.
        requestMock.mockResolvedValueOnce({ data: { info: [{ type: 0, source: 1, listid: 2, name: '我喜欢' }] } });
        await expect(kugouProvider.library?.getLikedSongCount?.('user')).resolves.toBeNull();
        requestMock.mockResolvedValueOnce({ data: { info: [{ type: 0, source: 1, listid: 8, name: '自建歌单', count: 4 }] } });
        await expect(kugouProvider.library?.getLikedSongCount?.('user')).resolves.toBeNull();
    });

    it('adds liked songs through the liked playlist mutation endpoint', async () => {
        requestMock
            .mockResolvedValueOnce({
                data: {
                    info: [{
                        type: 0,
                        source: 1,
                        listid: 2,
                        name: '我喜欢',
                        global_collection_id: 'collection_3_liked_test_add',
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
    });

    it('unlikes with the file id from the liked playlist instead of the current playlist', async () => {
        requestMock
            .mockResolvedValueOnce({
                data: {
                    info: [{
                        type: 0,
                        source: 1,
                        listid: 2,
                        name: '我喜欢',
                        global_collection_id: 'collection_3_liked_test_remove',
                    }],
                },
            })
            .mockResolvedValueOnce({
                data: {
                    count: 1,
                    songs: [{
                        hash: 'abc123',
                        name: 'Song 1',
                        fileid: 987,
                    }],
                },
            })
            .mockResolvedValueOnce({});

        const song = normalizeKugouSong({
            hash: 'abc123',
            name: 'Song 1',
            album_id: 12,
            mixsongid: 34,
            fileid: 102,
        });
        await kugouProvider.mutations?.likeSong?.(song, false);

        expect(requestMock).toHaveBeenNthCalledWith(2, 'playlist_track_all', {
            id: 'collection_3_liked_test_remove', page: 1, pagesize: 100,
        });
        expect(requestMock).toHaveBeenNthCalledWith(3, 'playlist_tracks_del', {
            listid: '2', fileids: '987',
        });
    });

    it('gives the account a cloud entry without asking KuGou for it', async () => {
        await expect(kugouProvider.library?.getCloudCollection?.({ id: 'user', nickname: 'Listener', avatarUrl: 'avatar.jpg' })).resolves.toMatchObject({
            providerId: 'kugou', id: 'cloud', type: 'cloud', coverUrl: 'avatar.jpg',
        });
        expect(requestMock).not.toHaveBeenCalled();
    });

    it('treats an unlike as done when the liked playlist does not contain the song', async () => {
        requestMock
            .mockResolvedValueOnce({
                data: {
                    info: [{
                        type: 0,
                        source: 1,
                        listid: 2,
                        name: '我喜欢',
                        global_collection_id: 'collection_3_liked_test_missing',
                    }],
                },
            })
            .mockResolvedValueOnce({
                data: {
                    count: 1,
                    songs: [{
                        hash: 'different-hash',
                        name: 'Other Song',
                        fileid: 42,
                    }],
                },
            });

        const song = normalizeKugouSong({
            hash: 'abc123',
            name: 'Song 1',
            album_id: 12,
            mixsongid: 34,
        });

        // 服务端本来就没有这首歌，目标状态已经达成：不发删除请求，也不能抛错把心形卡在点亮状态。
        await expect(kugouProvider.mutations?.likeSong?.(song, false)).resolves.toBeUndefined();
        expect(requestMock).not.toHaveBeenCalledWith('playlist_tracks_del', expect.anything());
        // 下结论之前必须绕过 10 秒缓存重扫一次。
        expect(requestMock.mock.calls.filter(([endpoint]) => endpoint === 'playlist_track_all')).toHaveLength(2);
    });

    it('rejects unlike when the liked playlist has no global collection id', async () => {
        requestMock.mockResolvedValueOnce({
            data: {
                info: [{
                    type: 0,
                    source: 1,
                    listid: 2,
                    name: '我喜欢',
                }],
            },
        });

        const song = normalizeKugouSong({
            hash: 'abc123',
            name: 'Song 1',
            album_id: 12,
            mixsongid: 34,
        });

        await expect(kugouProvider.mutations?.likeSong?.(song, false)).rejects.toMatchObject({
            code: 'invalid-response',
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
            coverUrl: 'https://imge.kugou.com/stdmusic/1024/20240621/20240621175302755566.jpg',
            trackCount: 1,
        });
        expect(tracks?.items[0]).toMatchObject({
            name: '晴天的乐章',
            artists: [{ id: '5883556', name: '玩音符的依舟' }],
            album: {
                id: '96920808',
                name: '晴天的乐章（芙宁娜原创曲）',
                coverUrl: 'https://imge.kugou.com/stdmusic/1024/20240621/20240621175302755566.jpg',
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

    it('fails instead of silently saving a truncated liked playlist', async () => {
        const fullPage = Array.from({ length: 100 }, (_, index) => ({ hash: `guard-${index}`, name: `Song ${index}` }));
        requestMock.mockImplementation(async (endpoint: string) => (
            endpoint === 'user_playlist'
                ? { data: { info: [{ type: 0, source: 1, listid: 2, name: '我喜欢', global_collection_id: 'collection_3_guard' }] } }
                : { data: { count: 10_000_000, songs: fullPage } }
        ));

        await expect(kugouProvider.library?.getLikedSongIds?.('user')).rejects.toMatchObject({
            code: 'invalid-response',
        });
    });

    it('stops reusing the liked playlist reference after a logout', async () => {
        const song = normalizeKugouSong({ hash: 'abc123', name: 'Song 1', album_id: 12, mixsongid: 34 });
        requestMock.mockImplementation(likedAnswers(2, 'collection_3_logout', 987));
        await kugouProvider.mutations?.likeSong?.(song, false);
        expect(requestMock).toHaveBeenNthCalledWith(1, 'user_playlist', expect.anything());

        // 第二次取消收藏直接吃缓存，不再拉歌单列表——先证明缓存确实在用。
        requestMock.mockClear();
        await kugouProvider.mutations?.likeSong?.(song, false);
        expect(asked('user_playlist')).toBe(0);
        expect(requestMock).toHaveBeenLastCalledWith('playlist_tracks_del', { listid: '2', fileids: '987' });

        requestMock.mockReset();
        requestMock.mockResolvedValue(undefined);
        await kugouProvider.auth?.logout?.();

        requestMock.mockReset();
        requestMock.mockImplementation(likedAnswers(9, 'collection_3_after_logout', 654));
        await kugouProvider.mutations?.likeSong?.(song, false);

        expect(requestMock).toHaveBeenNthCalledWith(1, 'user_playlist', expect.anything());
        expect(requestMock).toHaveBeenLastCalledWith('playlist_tracks_del', { listid: '9', fileids: '654' });
    });

    it('stops reusing the liked playlist reference when the session user changes', async () => {
        const song = normalizeKugouSong({ hash: 'abc123', name: 'Song 1', album_id: 12, mixsongid: 34 });
        requestMock.mockImplementation(likedAnswers(2, 'collection_3_user_a', 987));
        await kugouProvider.mutations?.likeSong?.(song, false);

        requestMock.mockClear();
        await kugouProvider.mutations?.likeSong?.(song, false);
        expect(asked('user_playlist')).toBe(0);

        sessionState.userId = 'second-session-user';
        requestMock.mockReset();
        requestMock.mockImplementation(likedAnswers(7, 'collection_3_user_b', 321));
        await kugouProvider.mutations?.likeSong?.(song, false);

        expect(requestMock).toHaveBeenNthCalledWith(1, 'user_playlist', {
            userid: 'second-session-user', page: 1, pagesize: 100,
        });
        expect(requestMock).toHaveBeenLastCalledWith('playlist_tracks_del', { listid: '7', fileids: '321' });
    });

    it('fails the liked-songs read instead of reporting an empty library', async () => {
        requestMock.mockResolvedValueOnce({
            data: { info: [{ type: 0, source: 1, listid: 2, name: '我的歌单' }] },
        });

        await expect(kugouProvider.library?.getLikedSongIds?.('user')).rejects.toMatchObject({
            code: 'invalid-response',
        });
    });

    it('does not cache a liked playlist reference that has no global collection id', async () => {
        const song = normalizeKugouSong({ hash: 'abc123', name: 'Song 1', album_id: 12, mixsongid: 34 });
        requestMock
            .mockResolvedValueOnce({
                data: { info: [{ type: 0, source: 1, listid: 2, name: '我喜欢' }] },
            })
            .mockResolvedValueOnce({});
        await kugouProvider.mutations?.likeSong?.(song, true);

        // 残缺引用要是被缓存下来，下一次取消收藏就会跳过 user_playlist 直接失败，一直粘到登出。
        requestMock.mockReset();
        requestMock.mockImplementation(likedAnswers(2, 'collection_3_recovered', 987));
        await kugouProvider.mutations?.likeSong?.(song, false);

        expect(requestMock).toHaveBeenNthCalledWith(1, 'user_playlist', expect.anything());
        expect(requestMock).toHaveBeenLastCalledWith('playlist_tracks_del', { listid: '2', fileids: '987' });
    });

    it('reports an auth error instead of a silent success when the session has no user id', async () => {
        sessionState.userId = '';
        const song = normalizeKugouSong({ hash: 'abc123', name: 'Song 1', album_id: 12, mixsongid: 34 });

        // 静默 return 会被 omni 当成 mutation 成功，心形照样翻转。
        await expect(kugouProvider.mutations?.likeSong?.(song, true)).rejects.toMatchObject({
            code: 'auth-required',
        });
        expect(requestMock).not.toHaveBeenCalled();
    });

    it('reports an invalid response instead of a silent success when the liked playlist has no listid', async () => {
        const song = normalizeKugouSong({ hash: 'abc123', name: 'Song 1', album_id: 12, mixsongid: 34 });
        requestMock.mockResolvedValueOnce({
            data: { info: [{ type: 0, source: 1, name: '我的歌单' }] },
        });

        await expect(kugouProvider.mutations?.likeSong?.(song, true)).rejects.toMatchObject({
            code: 'invalid-response',
        });
        expect(requestMock).not.toHaveBeenCalledWith('playlist_tracks_add', expect.anything());
    });
});
