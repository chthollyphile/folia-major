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

import { kugouProvider, normalizeKugouSong } from '@/services/onlineMusic/kugouProvider';

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
        expect(song.duration).toBe(240_000);
        expect(song.sourceRef).toEqual({
            kind: 'online',
            providerId: 'kugou',
            mediaId: 'AB12CD',
            providerData: {
                hash: 'AB12CD',
                mixSongId: 42,
                albumAudioId: 88,
                albumId: 9,
            },
        });
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
        const song = normalizeKugouSong({ FileHash: 'hash', SongName: 'Song', AlbumID: 2, ID: 3 });
        const source = await kugouProvider.playback?.getAudioSource(song, 'lossless');

        expect(requestMock).toHaveBeenCalledWith('song_url', expect.objectContaining({
            hash: 'HASH', quality: 'flac', album_id: '2', album_audio_id: '3',
        }));
        expect(source?.url).toBe('http://example.test/song.flac');
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
});
