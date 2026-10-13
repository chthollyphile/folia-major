import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '../../../src/types';

const hasCachedSongAudio = vi.fn<(song: SongResult) => Promise<boolean>>();
const hasCachedSongCover = vi.fn<(song: SongResult) => Promise<boolean>>();
const saveAudioBlob = vi.fn<(key: string, blob: Blob) => Promise<void>>();
const saveToCache = vi.fn<(key: string, value: unknown) => Promise<void>>();

vi.mock('../../../src/services/onlineMusic/resourceCache', () => ({
    hasCachedSongAudio: (song: SongResult) => hasCachedSongAudio(song),
    hasCachedSongCover: (song: SongResult) => hasCachedSongCover(song),
}));
vi.mock('../../../src/services/audioCache', () => ({
    saveAudioBlob: (key: string, blob: Blob) => saveAudioBlob(key, blob),
}));
vi.mock('../../../src/services/db', () => ({
    saveToCache: (key: string, value: unknown) => saveToCache(key, value),
}));

const { cachePlayedTrackAssets } = await import('../../../src/services/playedTrackCache');
const { getSongResourceCacheKey } = await import('../../../src/services/onlineMusic/resourceKeys');
const {
    clearCachedSongAudioDistrust,
    distrustCachedSongAudio,
    isCachedSongAudioDistrusted,
} = await import('../../../src/services/playbackRecovery/mediaCacheGuard');

/** A download that passes the cache write guard: HTTP OK, an audio type, and more than 16 KiB. */
const audioResponse = (overrides: { ok?: boolean; status?: number; contentType?: string; size?: number } = {}) => ({
    ok: overrides.ok ?? true,
    status: overrides.status ?? 200,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? overrides.contentType ?? 'audio/mpeg' : null) },
    blob: async () => new Blob([new Uint8Array(overrides.size ?? 32 * 1024)]),
});

// The audio and cover caches are pruned under separate categories, so every combination of
// "one present, the other missing" is a state ordinary use reaches. Each resource has to be asked
// about on its own: chaining them is what left a track whose audio was still cached unable to ever
// get its cover back.
describe('cachePlayedTrackAssets', () => {
    const onlineSong = {
        id: '1',
        name: 'Song',
        sourceRef: { kind: 'online', providerId: 'netease', mediaId: '1' },
        album: { coverUrl: 'https://cdn.example/cover.jpg' },
    } as unknown as SongResult;

    const localSong = {
        id: 'local-1',
        name: 'Local Song',
        sourceRef: { kind: 'local', mediaId: 'local-1' },
        album: { coverUrl: 'https://cdn.example/matched-cover.jpg' },
    } as unknown as SongResult;

    beforeEach(() => {
        vi.clearAllMocks();
        hasCachedSongAudio.mockResolvedValue(false);
        hasCachedSongCover.mockResolvedValue(false);
        saveAudioBlob.mockResolvedValue(undefined);
        saveToCache.mockResolvedValue(undefined);
        vi.stubGlobal('fetch', vi.fn(async () => audioResponse()));
        vi.spyOn(console, 'log').mockImplementation(() => { });
        clearCachedSongAudioDistrust(onlineSong);
    });

    it('stores both when neither is cached', async () => {
        const written = await cachePlayedTrackAssets(onlineSong, 'https://cdn.example/audio.mp3');

        expect(written).toEqual({ audio: true, cover: true });
        expect(saveAudioBlob).toHaveBeenCalledTimes(1);
        expect(saveToCache).toHaveBeenCalledTimes(1);
    });

    // The P15 case: the cover was pruned while the audio survived, and the cover has to come back
    // without waiting for the audio to go missing too.
    it('refills a missing cover while the audio is still cached', async () => {
        hasCachedSongAudio.mockResolvedValue(true);

        const written = await cachePlayedTrackAssets(onlineSong, 'https://cdn.example/audio.mp3');

        expect(written).toEqual({ audio: false, cover: true });
        expect(saveAudioBlob).not.toHaveBeenCalled();
        expect(saveToCache).toHaveBeenCalledTimes(1);
    });

    // Playing from cache renders a blob: URL. There is nothing to refetch for the audio, but that
    // says nothing about the cover - which is exactly what the old single early return assumed.
    it('still caches the cover when playback runs off a blob source', async () => {
        hasCachedSongAudio.mockResolvedValue(true);

        const written = await cachePlayedTrackAssets(onlineSong, 'blob:whatever');

        expect(written).toEqual({ audio: false, cover: true });
        expect(saveToCache).toHaveBeenCalledTimes(1);
    });

    it('stores the audio alone when the cover is already cached', async () => {
        hasCachedSongCover.mockResolvedValue(true);

        const written = await cachePlayedTrackAssets(onlineSong, 'https://cdn.example/audio.mp3');

        expect(written).toEqual({ audio: true, cover: false });
        expect(saveToCache).not.toHaveBeenCalled();
    });

    // A cover that is already cached reaches this as the app's own blob: URL for it. Refetching that
    // and writing it back is what the old code did on every play.
    it('ignores a blob cover URL', async () => {
        const written = await cachePlayedTrackAssets(onlineSong, 'https://cdn.example/audio.mp3', 'blob:cover');

        expect(written).toEqual({ audio: true, cover: false });
        expect(saveToCache).not.toHaveBeenCalled();
    });

    // A local song's cover has its own `cover_local_<id>` entry written by the library path. Storing
    // a matched online cover here would land under `cover_local:<id>`, which nothing reads.
    it('does not store a cover for a local song', async () => {
        const written = await cachePlayedTrackAssets(localSong, 'blob:local-file');

        expect(written).toEqual({ audio: false, cover: false });
        expect(saveToCache).not.toHaveBeenCalled();
    });

    it('reports nothing written when a download fails', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
        vi.spyOn(console, 'error').mockImplementation(() => { });

        const written = await cachePlayedTrackAssets(onlineSong, 'https://cdn.example/audio.mp3');

        expect(written).toEqual({ audio: false, cover: false });
        expect(saveAudioBlob).not.toHaveBeenCalled();
        expect(saveToCache).not.toHaveBeenCalled();
    });

    // 缓存命中优先于 provider：一份错误页一旦被存成音频，之后每次播放都会顶替真音源。
    describe('the audio write guard', () => {
        const stubAudioDownload = (response: ReturnType<typeof audioResponse>) => {
            vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.endsWith('.mp3') ? response : audioResponse())));
            vi.spyOn(console, 'warn').mockImplementation(() => { });
        };

        it('does not store a 403 answer', async () => {
            stubAudioDownload(audioResponse({ ok: false, status: 403 }));

            const written = await cachePlayedTrackAssets(onlineSong, 'https://cdn.example/audio.mp3');

            expect(written).toEqual({ audio: false, cover: true });
            expect(saveAudioBlob).not.toHaveBeenCalled();
        });

        it('does not store an HTML page served with 200', async () => {
            stubAudioDownload(audioResponse({ contentType: 'text/html; charset=utf-8' }));

            const written = await cachePlayedTrackAssets(onlineSong, 'https://cdn.example/audio.mp3');

            expect(written).toEqual({ audio: false, cover: true });
            expect(saveAudioBlob).not.toHaveBeenCalled();
        });

        it('does not store a truncated download', async () => {
            stubAudioDownload(audioResponse({ size: 1024 }));

            const written = await cachePlayedTrackAssets(onlineSong, 'https://cdn.example/audio.mp3');

            expect(written.audio).toBe(false);
            expect(saveAudioBlob).not.toHaveBeenCalled();
        });

        it('keeps a distrusted song distrusted when the new download is not audio either', async () => {
            hasCachedSongAudio.mockResolvedValue(true);
            distrustCachedSongAudio(onlineSong);
            stubAudioDownload(audioResponse({ contentType: 'application/json' }));

            const written = await cachePlayedTrackAssets(onlineSong, 'https://cdn.example/audio.mp3');

            expect(written.audio).toBe(false);
            expect(saveAudioBlob).not.toHaveBeenCalled();
            expect(isCachedSongAudioDistrusted(onlineSong)).toBe(true);
        });
    });

    // 缓存 blob 解码失败后本会话不再信任它；这首歌完整播放一遍（走的是 provider 地址）就用合格的下载覆盖掉坏的那份。
    it('rewrites a distrusted cached song and clears the distrust', async () => {
        hasCachedSongAudio.mockResolvedValue(true);
        hasCachedSongCover.mockResolvedValue(true);
        distrustCachedSongAudio(onlineSong);

        const written = await cachePlayedTrackAssets(onlineSong, 'https://cdn.example/audio.mp3');

        expect(written).toEqual({ audio: true, cover: false });
        expect(saveAudioBlob).toHaveBeenCalledTimes(1);
        expect(saveAudioBlob.mock.calls[0][0]).toBe(getSongResourceCacheKey('audio', onlineSong));
        expect(isCachedSongAudioDistrusted(onlineSong)).toBe(false);
    });
});
