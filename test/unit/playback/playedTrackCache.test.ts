import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '../../../src/types';
import { getPlaybackSongKey } from '../../../src/utils/appPlaybackGuards';

const hasCachedSongAudio = vi.fn<(song: SongResult, level?: string) => Promise<boolean>>();
const hasCachedSongCover = vi.fn<(song: SongResult) => Promise<boolean>>();
const saveSongAudioLevel = vi.fn<(song: SongResult, level?: string) => Promise<void>>();
const levelOfAudioSource = vi.fn<(url: string) => string | undefined>();
const isPreviewAudioSource = vi.fn<(url: string) => boolean>();
const saveAudioBlob = vi.fn<(key: string, blob: Blob) => Promise<void>>();
const notifyAudioCached = vi.fn<(key: string, keptUrl?: string) => void>();
const saveToCache = vi.fn<(key: string, value: unknown) => Promise<void>>();

vi.mock('../../../src/services/onlineMusic/resourceCache', () => ({
    hasCachedSongAudio: (song: SongResult, level?: string) => hasCachedSongAudio(song, level),
    hasCachedSongCover: (song: SongResult) => hasCachedSongCover(song),
    saveSongAudioLevel: (song: SongResult, level?: string) => saveSongAudioLevel(song, level),
}));
vi.mock('../../../src/services/onlineMusic/omni', () => ({
    omni: {
        levelOfAudioSource: (url: string) => levelOfAudioSource(url),
        isPreviewAudioSource: (url: string) => isPreviewAudioSource(url),
    },
}));
vi.mock('../../../src/services/audioCache', () => ({
    saveAudioBlob: (key: string, blob: Blob) => saveAudioBlob(key, blob),
    notifyAudioCached: (key: string, keptUrl?: string) => notifyAudioCached(key, keptUrl),
    cacheLimitBytes: () => 4096,
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

// Stands in for the element the writer reads a fetched file's play length with. `header` is what
// it finds in the file: the play length in seconds, 'unreadable' for a file it reports an error
// for, 'silent' for one it never answers about.
let header: number | 'unreadable' | 'silent';
const headerReaders = vi.fn();
class HeaderReader {
    preload = '';
    duration = NaN;
    onloadedmetadata: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() { headerReaders(); }
    set src(_url: string) {
        queueMicrotask(() => {
            if (header === 'unreadable') this.onerror?.();
            else if (header !== 'silent') { this.duration = header; this.onloadedmetadata?.(); }
        });
    }
    removeAttribute() { }
    load() { }
}

// The audio and cover caches are pruned under separate categories, so every combination of
// "one present, the other missing" is a state ordinary use reaches. Each resource has to be asked
// about on its own: chaining them is what left a track whose audio was still cached unable to ever
// get its cover back.
describe('cachePlayedTrackAssets', () => {
    const onlineSong = {
        id: '1',
        name: 'Song',
        durationMs: 200_000,
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
        saveSongAudioLevel.mockResolvedValue(undefined);
        levelOfAudioSource.mockReturnValue(undefined);
        isPreviewAudioSource.mockReturnValue(false);
        saveAudioBlob.mockResolvedValue(undefined);
        saveToCache.mockResolvedValue(undefined);
        vi.stubGlobal('fetch', vi.fn(async () => audioResponse()));
        // Every file fetched plays as long as the song, unless a test says otherwise.
        header = 200;
        vi.stubGlobal('Audio', HeaderReader);
        vi.spyOn(console, 'log').mockImplementation(() => { });
        clearCachedSongAudioDistrust(onlineSong);
    });

    // An expired or refused stream URL answers with an error page. That page is a body like any
    // other, and once stored the cached copy always wins over a fresh fetch.
    it('does not store an error response as the track audio', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, blob: async () => new Blob(['Forbidden']) })));
        vi.spyOn(console, 'error').mockImplementation(() => { });
        hasCachedSongCover.mockResolvedValue(true);

        const written = await cachePlayedTrackAssets(onlineSong, 'https://cdn.example/audio.mp3');

        expect(written).toEqual({ audio: false, cover: false });
        expect(saveAudioBlob).not.toHaveBeenCalled();
    });

    it('stores both when neither is cached', async () => {
        const written = await cachePlayedTrackAssets(onlineSong, 'https://cdn.example/audio.mp3');

        expect(written).toEqual({ audio: true, cover: true });
        expect(saveAudioBlob).toHaveBeenCalledTimes(1);
        expect(saveToCache).toHaveBeenCalledTimes(1);
    });

    // The audio key names the song and no quality level, so the level is kept beside the copy. It is
    // the level of the URL the song played from, which omni noted when it handed the URL out: the
    // quality option may have been moved while the song played, and is not asked here at all.
    describe('with a copy of the song already in the media cache', () => {
        const src = 'https://cdn.example/audio.mp3';
        // The cache as it answers while it holds a copy fetched at 'standard'.
        const holdStandardCopy = () => hasCachedSongAudio.mockImplementation(async (_song, level) => !level || level === 'standard');

        beforeEach(() => hasCachedSongCover.mockResolvedValue(true));

        it('writes over a copy of another level than the URL the song played from', async () => {
            holdStandardCopy();
            levelOfAudioSource.mockReturnValue('high');

            const written = await cachePlayedTrackAssets(onlineSong, src);

            expect(written).toEqual({ audio: true, cover: false });
            expect(levelOfAudioSource).toHaveBeenCalledWith(src);
            expect(saveAudioBlob).toHaveBeenCalledTimes(1);
            // The level of the copy is removed before the audio is written, the new one saved after.
            expect(saveSongAudioLevel.mock.calls).toEqual([[onlineSong, undefined], [onlineSong, 'high']]);
            const [removed, saved] = saveSongAudioLevel.mock.invocationCallOrder;
            const [audioWritten] = saveAudioBlob.mock.invocationCallOrder;
            expect(removed).toBeLessThan(audioWritten);
            expect(audioWritten).toBeLessThan(saved);
        });

        // The level write swallows its errors (db.ts). Were the old level still there when the
        // audio is written, a failure after it would leave the new file under the old level's name.
        it('leaves no level saved when the audio could not be written over the copy', async () => {
            holdStandardCopy();
            levelOfAudioSource.mockReturnValue('high');
            saveAudioBlob.mockRejectedValue(new Error('disk full'));
            vi.spyOn(console, 'error').mockImplementation(() => { });

            const written = await cachePlayedTrackAssets(onlineSong, src);

            expect(written).toEqual({ audio: false, cover: false });
            expect(saveSongAudioLevel).toHaveBeenCalledExactlyOnceWith(onlineSong, undefined);
        });

        // A provider may answer a song with less than the song (NetEase: a preview clip of a song
        // that became members-only). The copy on disk is the whole song, so only a file proven to
        // be the whole song takes its place: one whose header says it plays for at least 90% of
        // the song's stated length, here 200 seconds.
        const fetchedAtHigh = async (song = onlineSong) => {
            holdStandardCopy();
            levelOfAudioSource.mockReturnValue('high');
            return cachePlayedTrackAssets(song, src);
        };
        const expectCopyKept = async (writing: Promise<{ audio: boolean; cover: boolean }>, why: string) => {
            expect(await writing).toEqual({ audio: false, cover: false });
            expect(saveAudioBlob).not.toHaveBeenCalled();
            expect(saveSongAudioLevel).not.toHaveBeenCalled();
            expect(console.log).toHaveBeenLastCalledWith(`[Cache] Copy of ${getPlaybackSongKey(onlineSong)} kept, the file fetched at high is ${why}`);
        };
        const unproven = (statedLength = '200.0s') => `not proven to be the whole song: play length unknown, stated length ${statedLength}`;

        it('writes over the copy with a file that plays for nine tenths of the song', async () => {
            header = 180;

            expect(await fetchedAtHigh()).toEqual({ audio: true, cover: false });
            expect(saveAudioBlob).toHaveBeenCalledTimes(1);
        });

        // Under 90% the file is not proven whole and the copy stays; under half it is not the song.
        it.each([
            [179.9, 'not proven to be the whole song'],
            [100, 'not proven to be the whole song'],
            [30, 'shorter than half the song'],
        ])('keeps the copy when the file fetched plays for %d seconds of the song', async (seconds, why) => {
            header = seconds;

            await expectCopyKept(fetchedAtHigh(), `${why}: play length ${seconds.toFixed(1)}s, stated length 200.0s`);
        });

        it.each([
            ['its header names no length', Infinity],
            ['the element cannot read it', 'unreadable' as const],
        ])('keeps the copy when the play length of the file fetched cannot be told: %s', async (_why, found) => {
            header = found;

            await expectCopyKept(fetchedAtHigh(), unproven());
        });

        it('keeps the copy where there is no Audio to read the file fetched with', async () => {
            vi.stubGlobal('Audio', undefined);

            await expectCopyKept(fetchedAtHigh(), unproven());
        });

        it('keeps the copy when the header of the file fetched gives no answer in five seconds', async () => {
            header = 'silent';
            vi.useFakeTimers();
            try {
                const writing = fetchedAtHigh();
                await vi.advanceTimersByTimeAsync(5000);

                await expectCopyKept(writing, unproven());
            } finally {
                vi.useRealTimers();
            }
        });

        it('keeps the copy of a song that states no length', async () => {
            await expectCopyKept(fetchedAtHigh({ ...onlineSong, durationMs: 0 }), unproven('unknown'));
        });


        it('does not write again over a copy of the same level', async () => {
            holdStandardCopy();
            levelOfAudioSource.mockReturnValue('standard');

            const written = await cachePlayedTrackAssets(onlineSong, src);

            expect(written).toEqual({ audio: false, cover: false });
            expect(fetch).not.toHaveBeenCalled();
            expect(saveAudioBlob).not.toHaveBeenCalled();
            expect(saveSongAudioLevel).not.toHaveBeenCalled();
        });

        // A local or Navidrome song, or a URL an extension swapped in: any copy counts, as before.
        it('leaves any copy alone when the level of the URL is not known', async () => {
            holdStandardCopy();

            const written = await cachePlayedTrackAssets(onlineSong, src);

            expect(written).toEqual({ audio: false, cover: false });
            expect(saveAudioBlob).not.toHaveBeenCalled();
        });
    });

    // A song with no copy yet. A clip stored as its first copy played in the song's place for good:
    // playback takes a copy before it asks the platform. So a URL marked as a preview, or a file
    // proven shorter than the song, is not stored here either; only where nothing can be told is the
    // file saved as it comes, as it always was.
    describe('with no copy of the song yet', () => {
        const src = 'https://cdn.example/audio.mp3';
        beforeEach(() => {
            hasCachedSongCover.mockResolvedValue(true);
            levelOfAudioSource.mockReturnValue('high');
        });
        const expectNotStored = async (why: string) => {
            expect(await cachePlayedTrackAssets(onlineSong, src)).toEqual({ audio: false, cover: false });
            expect(saveAudioBlob).not.toHaveBeenCalled();
            expect(saveSongAudioLevel).not.toHaveBeenCalled();
            expect(console.log).toHaveBeenLastCalledWith(`[Cache] ${getPlaybackSongKey(onlineSong)} not stored, the file fetched at high is ${why}`);
        };

        it('does not store a file that plays for 30 seconds of the song', async () => {
            header = 30;

            await expectNotStored('shorter than half the song: play length 30.0s, stated length 200.0s');
        });

        // The stated length may be another version's: a whole song more than a tenth shorter than
        // it is still stored where there is no copy. Only a file under half the song is refused.
        it.each([[100], [170]])('saves a file that plays for %d seconds of the song', async seconds => {
            header = seconds;

            expect(await cachePlayedTrackAssets(onlineSong, src)).toEqual({ audio: true, cover: false });
            expect(saveAudioBlob).toHaveBeenCalledTimes(1);
        });

        it('saves a file whose play length cannot be told', async () => {
            header = 'unreadable';

            expect(await cachePlayedTrackAssets(onlineSong, src)).toEqual({ audio: true, cover: false });
            expect(saveSongAudioLevel).toHaveBeenCalledExactlyOnceWith(onlineSong, 'high');
        });
    });

    // A clip its provider marked is never stored, so it is not downloaded only to be refused: with
    // a copy on disk or none. The cover is the song's own, and is kept as for any song.
    it.each([[false], [true]])('does not download a URL its provider marked as a preview clip (a copy on disk: %s)', async withCopy => {
        isPreviewAudioSource.mockReturnValue(true);
        hasCachedSongAudio.mockResolvedValue(withCopy);
        const src = 'https://cdn.example/trial.mp3';

        expect(await cachePlayedTrackAssets(onlineSong, src)).toEqual({ audio: false, cover: true });
        expect(fetch).toHaveBeenCalledExactlyOnceWith('https://cdn.example/cover.jpg', { mode: 'cors' });
        expect(saveAudioBlob).not.toHaveBeenCalled();
        expect(saveSongAudioLevel).not.toHaveBeenCalled();
        expect(isPreviewAudioSource).toHaveBeenCalledWith(src);
        expect(console.log).toHaveBeenCalledWith(`[Cache] ${getPlaybackSongKey(onlineSong)} not stored, the URL it played from is a preview clip, as its provider said`);
    });

    // The copy written is then of an unknown level, and a level saved for an earlier copy of the
    // song must not stay behind to describe it: `saveSongAudioLevel` removes it when given none.
    it('saves no level with a copy fetched from a URL of an unknown level', async () => {
        hasCachedSongCover.mockResolvedValue(true);

        await cachePlayedTrackAssets(onlineSong, 'https://cdn.example/audio.mp3');

        expect(saveAudioBlob).toHaveBeenCalledTimes(1);
        expect(saveSongAudioLevel).toHaveBeenCalledExactlyOnceWith(onlineSong, undefined);
    });

    it('saves no level when the audio could not be saved', async () => {
        hasCachedSongCover.mockResolvedValue(true);
        levelOfAudioSource.mockReturnValue('high');
        saveAudioBlob.mockRejectedValue(new Error('disk full'));
        vi.spyOn(console, 'error').mockImplementation(() => { });

        const written = await cachePlayedTrackAssets(onlineSong, 'https://cdn.example/audio.mp3');

        expect(written).toEqual({ audio: false, cover: false });
        expect(saveSongAudioLevel).not.toHaveBeenCalled();
    });

    // Spotify keeps its audio in a cache of its own (encrypted, on the desktop side). The played
    // track is not read here and nothing of it goes to the media cache: the provider is asked to
    // keep the file the song played from, and a separation waiting for the song is told. The cover
    // is kept like any other.
    describe('for a provider with a cache of its own', () => {
        const spotifySong = {
            ...onlineSong, sourceRef: { kind: 'online', providerId: 'spotify', mediaId: '4cOdK2wGLETKBW3PvgPWqT' },
        } as unknown as SongResult;
        const src = 'folia-spotify://audio/4cOdK2wGLETKBW3PvgPWqT?k=1';
        const desktop = (answers: Record<string, boolean>) => {
            const asked: Array<[string, unknown]> = [];
            vi.stubGlobal('window', { electron: { spotifyRequest: async (operation: string, params: unknown) => {
                asked.push([operation, params]);
                return { ok: true, data: answers[operation] };
            } } });
            return asked;
        };

        it('has the provider keep the played track, and writes none of it to the media cache', async () => {
            const asked = desktop({ audio_kept: false, audio_keep: true });

            const written = await cachePlayedTrackAssets(spotifySong, src);

            expect(written).toEqual({ audio: true, cover: true });
            expect(asked).toEqual([['audio_kept', { url: src }], ['audio_keep', { url: src, limitBytes: 4096 }]]);
            expect(notifyAudioCached).toHaveBeenCalledWith(getSongResourceCacheKey('audio', spotifySong), src);
            expect(saveAudioBlob).not.toHaveBeenCalled();
            expect(fetch).toHaveBeenCalledTimes(1);
            expect(fetch).toHaveBeenCalledWith('https://cdn.example/cover.jpg', { mode: 'cors' });
        });

        it('asks for nothing more when the provider already keeps the track', async () => {
            const asked = desktop({ audio_kept: true, audio_keep: true });

            const written = await cachePlayedTrackAssets(spotifySong, src);

            expect(written).toEqual({ audio: false, cover: true });
            expect(asked).toEqual([['audio_kept', { url: src }]]);
            expect(notifyAudioCached).not.toHaveBeenCalled();
        });

        it('reports nothing written when the provider could not keep it', async () => {
            desktop({ audio_kept: false, audio_keep: false });

            expect(await cachePlayedTrackAssets(spotifySong, src)).toEqual({ audio: false, cover: true });
            expect(notifyAudioCached).not.toHaveBeenCalled();
            expect(saveAudioBlob).not.toHaveBeenCalled();
        });
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
