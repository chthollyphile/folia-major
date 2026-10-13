import { beforeEach, describe, expect, it, vi } from 'vitest';

const cachedAudioMock = vi.hoisted(() => vi.fn());
const songCacheMock = vi.hoisted(() => vi.fn());
const sourceMock = vi.hoisted(() => vi.fn());
const lyricsMock = vi.hoisted(() => vi.fn());
const autoMatchMock = vi.hoisted(() => vi.fn());
const loadLyricsStateMock = vi.hoisted(() => vi.fn());
const saveLyricsStateMock = vi.hoisted(() => vi.fn());
const isUrlValidMock = vi.hoisted(() => vi.fn(() => true));
const updatePrefetchedAudioUrlMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/onlineMusic/resourceCache', () => ({
    getCachedSongAudioBlob: cachedAudioMock,
    getCachedSongReplayGain: vi.fn(async () => undefined),
    getSongCacheWithLegacyMigration: songCacheMock,
}));

vi.mock('@/services/onlineMusic/omni', () => ({
    omni: {
        getAudioSource: sourceMock,
        getLyrics: lyricsMock,
    },
}));

vi.mock('@/stores/useLyricSettingsStore', () => ({
    useLyricSettingsStore: {
        getState: () => ({ autoUseBestLyric: true, preferredAlternativeLyricSource: 'qq' }),
    },
}));

vi.mock('@/utils/lyrics/autoMatchBestLyric', () => ({
    autoMatchBestLyric: autoMatchMock,
}));

// Spread the real module so markOnlineLyricsPureMusic stays real - the shape it writes is the
// thing under test, and a stubbed one would assert nothing.
vi.mock('@/utils/onlineLyricsState', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/utils/onlineLyricsState')>()),
    loadOnlineLyricsState: loadLyricsStateMock,
    resolveOnlineLyrics: (_state: unknown, lyrics: unknown) => lyrics,
    saveOnlineLyricsState: saveLyricsStateMock,
}));

vi.mock('@/services/prefetchService', () => ({
    isUrlValid: isUrlValidMock,
    updatePrefetchedAudioUrl: updatePrefetchedAudioUrlMock,
}));

vi.mock('@/services/db', () => ({
    saveToCache: vi.fn(),
}));

vi.mock('@/utils/blobGuards', () => ({
    createSafeObjectUrl: vi.fn(() => 'blob:test'),
}));

import { loadOnlineSongAudioSource, loadOnlineSongLyrics } from '@/services/onlinePlayback';
import { markOnlineLyricsPureMusic } from '@/utils/onlineLyricsState';
import type { SongResult } from '@/types';
import { OnlineProviderError } from '@/types/onlineMusic';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import { resetProviderPlaybackCooldowns } from '@/services/playbackRecovery/providerPlaybackCooldown';
import { clearCachedSongAudioDistrust, distrustCachedSongAudio } from '@/services/playbackRecovery/mediaCacheGuard';

// test/unit/onlinePlayback.test.ts

const song: SongResult = {
    id: 'online-song',
    name: 'Song',
    artists: [],
    album: { id: 'album', name: 'Album' },
    durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'kugou', mediaId: 'online-song' },
};

describe('online audio ReplayGain plumbing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        cachedAudioMock.mockResolvedValue(null);
        isUrlValidMock.mockReturnValue(true);
        resetProviderPlaybackCooldowns();
        useOnlineProviderAccountStore.setState({ accounts: {} });
    });

    it.each([
        ['preview-only', 'preview-only'],
        ['region-restricted', 'region-restricted'],
        // 默认账号快照为空：没有会话可言，只能说“未登录”，不能说“已失效”。
        ['auth-required', 'not-signed-in'],
    ] as const)('preserves %s for the queue and does not cache audio', async (code, reason) => {
        sourceMock.mockRejectedValueOnce(new OnlineProviderError(code, 'Playback unavailable', 'bodian'));
        await expect(loadOnlineSongAudioSource(song, 'high', null)).resolves.toMatchObject({ kind: 'failed', failure: { reason } });
        expect(updatePrefetchedAudioUrlMock).not.toHaveBeenCalled();
    });

    it('returns provider metadata and stores it with the prefetched URL', async () => {
        sourceMock.mockResolvedValue({
            url: 'https://audio.test/song.flac',
            fetchedAt: 1,
            quality: 'high',
            replayGain: { trackGain: -12.1, trackPeak: 0.95 },
        });

        const result = await loadOnlineSongAudioSource(song, 'high', null);

        expect(result).toMatchObject({
            kind: 'ok',
            audioSrc: 'https://audio.test/song.flac',
            replayGain: { trackGain: -12.1, trackPeak: 0.95 },
        });
        expect(updatePrefetchedAudioUrlMock).toHaveBeenCalledWith(
            song,
            'https://audio.test/song.flac',
            'high',
            { trackGain: -12.1, trackPeak: 0.95 },
        );
    });

    it('reuses prefetched metadata without asking the provider again', async () => {
        const prefetched = {
            audioUrl: 'https://audio.test/prefetched.flac',
            audioUrlFetchedAt: Date.now(),
            replayGain: { trackGain: -3.2 },
        } as any;

        const result = await loadOnlineSongAudioSource(song, 'high', prefetched);

        expect(result).toMatchObject({
            kind: 'ok',
            audioSrc: 'https://audio.test/prefetched.flac',
            replayGain: { trackGain: -3.2 },
        });
        expect(sourceMock).not.toHaveBeenCalled();
    });

    it('leaves ReplayGain absent when the provider has no metadata', async () => {
        sourceMock.mockResolvedValue({
            url: 'https://audio.test/song.mp3',
            fetchedAt: 1,
            quality: 'high',
        });

        const result = await loadOnlineSongAudioSource(song, 'high', null);

        expect(result).toMatchObject({ kind: 'ok', audioSrc: 'https://audio.test/song.mp3' });
        expect(result.kind).toBe('ok');
        if (result.kind === 'ok') {
            expect(result.replayGain).toBeUndefined();
        }
        expect(updatePrefetchedAudioUrlMock).toHaveBeenCalledWith(song, 'https://audio.test/song.mp3', 'high', undefined);
    });
});

describe('online audio source failures', () => {
    const okSource = { url: 'https://audio.test/song.mp3', fetchedAt: 1, quality: 'high' as const };

    beforeEach(() => {
        vi.clearAllMocks();
        sourceMock.mockReset();
        cachedAudioMock.mockReset();
        cachedAudioMock.mockResolvedValue(null);
        isUrlValidMock.mockReturnValue(true);
        resetProviderPlaybackCooldowns();
        clearCachedSongAudioDistrust(song);
        useOnlineProviderAccountStore.setState({ accounts: {} });
    });

    it('reads auth-required as an expired session when the account was signed in before the request', async () => {
        useOnlineProviderAccountStore.getState().updateAccount('kugou', { status: 'authenticated' });
        sourceMock.mockImplementationOnce(async () => {
            // transport 在鉴权失败时会清理会话；分类必须看请求之前的快照。
            useOnlineProviderAccountStore.getState().clearAccount('kugou');
            throw new OnlineProviderError('auth-required', 'Session rejected', 'kugou');
        });

        await expect(loadOnlineSongAudioSource(song, 'high', null)).resolves.toMatchObject({
            kind: 'failed',
            failure: { reason: 'session-expired', stage: 'resolve-url', providerId: 'kugou' },
        });
    });

    it.each([
        ['no source', () => sourceMock.mockResolvedValueOnce(null), 'unknown'],
        ['an empty URL', () => sourceMock.mockResolvedValueOnce({ ...okSource, url: '' }), 'unknown'],
        ['a script URL', () => sourceMock.mockResolvedValueOnce({ ...okSource, url: 'javascript:x' }), 'invalid-response'],
        ['a plain Error', () => sourceMock.mockRejectedValueOnce(new Error('boom')), 'unknown'],
        ['HTTP 429 with a wait', () => sourceMock.mockRejectedValueOnce(new OnlineProviderError('network', 'Too many', 'kugou', undefined, 429, 25_000)), 'rate-limited'],
        ['HTTP 503', () => sourceMock.mockRejectedValueOnce(new OnlineProviderError('network', 'Down', 'kugou', undefined, 503)), 'service-unavailable'],
    ] as const)('reports %s as a structured failure and never touches the prefetch entry', async (_label, arrange, reason) => {
        arrange();

        const result = await loadOnlineSongAudioSource(song, 'high', null);

        expect(result).toMatchObject({ kind: 'failed', failure: { reason, stage: 'resolve-url', providerId: 'kugou' } });
        expect(updatePrefetchedAudioUrlMock).not.toHaveBeenCalled();
    });

    it('passes the requested stage through', async () => {
        sourceMock.mockResolvedValueOnce(null);
        await expect(loadOnlineSongAudioSource(song, 'high', null, { stage: 'refresh' })).resolves.toMatchObject({
            kind: 'failed',
            failure: { stage: 'refresh' },
        });
    });

    describe('quiet retries', () => {
        const networkError = () => new OnlineProviderError('network', 'offline', 'kugou');

        it('retries a network failure and returns the source that follows', async () => {
            sourceMock.mockRejectedValueOnce(networkError()).mockResolvedValueOnce(okSource);
            const sleep = vi.fn(async (_ms: number) => { });
            const onRetrying = vi.fn();

            const result = await loadOnlineSongAudioSource(song, 'high', null, { retry: { isCurrent: () => true, onRetrying, sleep } });

            expect(result).toMatchObject({ kind: 'ok', audioSrc: okSource.url });
            expect(sourceMock).toHaveBeenCalledTimes(2);
            expect(sleep.mock.calls).toEqual([[1000]]);
            expect(onRetrying).toHaveBeenCalledWith(expect.objectContaining({ reason: 'network' }), 1);
            expect(updatePrefetchedAudioUrlMock).toHaveBeenCalledTimes(1);
        });

        it('gives up after the policy delays run out', async () => {
            sourceMock.mockRejectedValue(networkError());
            const sleep = vi.fn(async (_ms: number) => { });

            const result = await loadOnlineSongAudioSource(song, 'high', null, { retry: { isCurrent: () => true, sleep } });

            expect(result).toMatchObject({ kind: 'failed', failure: { reason: 'network' } });
            expect(sourceMock).toHaveBeenCalledTimes(3);
            expect(sleep.mock.calls).toEqual([[1000], [3000]]);
        });

        it('retries a timeout once', async () => {
            sourceMock.mockRejectedValue(new OnlineProviderError('timeout', 'slow', 'kugou'));
            const sleep = vi.fn(async (_ms: number) => { });

            await loadOnlineSongAudioSource(song, 'high', null, { retry: { isCurrent: () => true, sleep } });

            expect(sourceMock).toHaveBeenCalledTimes(2);
            expect(sleep.mock.calls).toEqual([[2000]]);
        });

        it('stops as soon as the request is no longer current', async () => {
            sourceMock.mockRejectedValue(networkError());
            let current = true;
            const sleep = vi.fn(async (_ms: number) => { current = false; });

            const result = await loadOnlineSongAudioSource(song, 'high', null, { retry: { isCurrent: () => current, sleep } });

            expect(result).toMatchObject({ kind: 'failed', failure: { reason: 'network' } });
            expect(sourceMock).toHaveBeenCalledTimes(1);
            expect(sleep).toHaveBeenCalledTimes(1);
        });

        it('does not retry a stale request at all', async () => {
            sourceMock.mockRejectedValue(networkError());
            const sleep = vi.fn(async (_ms: number) => { });
            const onRetrying = vi.fn();

            await loadOnlineSongAudioSource(song, 'high', null, { retry: { isCurrent: () => false, onRetrying, sleep } });

            expect(sourceMock).toHaveBeenCalledTimes(1);
            expect(sleep).not.toHaveBeenCalled();
            expect(onRetrying).not.toHaveBeenCalled();
        });

        it.each([
            ['unknown', () => sourceMock.mockResolvedValue(null)],
            ['auth', () => sourceMock.mockRejectedValue(new OnlineProviderError('auth-required', 'no', 'kugou'))],
        ] as const)('does not retry %s', async (_label, arrange) => {
            arrange();
            const sleep = vi.fn(async (_ms: number) => { });

            await loadOnlineSongAudioSource(song, 'high', null, { retry: { isCurrent: () => true, sleep } });

            expect(sourceMock).toHaveBeenCalledTimes(1);
            expect(sleep).not.toHaveBeenCalled();
        });

        it('does not retry without retry options', async () => {
            sourceMock.mockRejectedValue(networkError());

            await loadOnlineSongAudioSource(song, 'high', null);

            expect(sourceMock).toHaveBeenCalledTimes(1);
        });
    });

    it('answers from the cooldown without asking the provider again after a stated Retry-After', async () => {
        sourceMock.mockRejectedValueOnce(new OnlineProviderError('network', 'Too many', 'kugou', undefined, 429, 25_000));
        await loadOnlineSongAudioSource(song, 'high', null);

        const second = await loadOnlineSongAudioSource(song, 'high', null);

        expect(sourceMock).toHaveBeenCalledTimes(1);
        expect(second).toMatchObject({ kind: 'failed', failure: { reason: 'rate-limited', stage: 'cooldown', providerId: 'kugou' } });
        if (second.kind === 'failed') {
            expect(second.failure.retryAfterMs).toBeGreaterThan(0);
            expect(second.failure.retryAfterMs).toBeLessThanOrEqual(25_000);
        }
    });

    describe('media cache', () => {
        it('falls back to the provider when reading the cache throws', async () => {
            cachedAudioMock.mockRejectedValueOnce(new Error('IndexedDB is gone'));
            sourceMock.mockResolvedValueOnce(okSource);

            await expect(loadOnlineSongAudioSource(song, 'high', null)).resolves.toMatchObject({ kind: 'ok', audioSrc: okSource.url });
            expect(sourceMock).toHaveBeenCalledTimes(1);
        });

        it('uses the cached blob by default', async () => {
            cachedAudioMock.mockResolvedValueOnce(new Blob([new Uint8Array([1])]));

            await expect(loadOnlineSongAudioSource(song, 'high', null)).resolves.toMatchObject({ kind: 'ok', audioSrc: 'blob:test', blobUrl: 'blob:test' });
            expect(sourceMock).not.toHaveBeenCalled();
        });

        it('skips the cached blob when asked to bypass it', async () => {
            cachedAudioMock.mockResolvedValue(new Blob([new Uint8Array([1])]));
            sourceMock.mockResolvedValueOnce(okSource);

            await expect(loadOnlineSongAudioSource(song, 'high', null, { bypassMediaCache: true })).resolves.toMatchObject({ kind: 'ok', audioSrc: okSource.url });
            expect(cachedAudioMock).not.toHaveBeenCalled();
        });

        it('skips the cached blob of a song whose cache is distrusted', async () => {
            cachedAudioMock.mockResolvedValue(new Blob([new Uint8Array([1])]));
            sourceMock.mockResolvedValueOnce(okSource);
            distrustCachedSongAudio(song);

            await expect(loadOnlineSongAudioSource(song, 'high', null)).resolves.toMatchObject({ kind: 'ok', audioSrc: okSource.url });
            expect(cachedAudioMock).not.toHaveBeenCalled();
        });
    });
});

describe('online QQ lyric candidate plumbing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        songCacheMock.mockResolvedValue(null);
        loadLyricsStateMock.mockResolvedValue(null);
    });

    it('passes the already-loaded QQ song and lyrics to auto-match as its provider candidate', async () => {
        const qqSong: SongResult = {
            ...song,
            id: 201,
            qqMid: 'qq-mid',
            sourceRef: { kind: 'online', providerId: 'qq', mediaId: 'qq-mid' },
        };
        const lyrics = {
            lines: [{ startTime: 0, endTime: 1, fullText: 'line', words: [] }],
            isWordByWord: true,
        };
        lyricsMock.mockResolvedValue({
            lyrics,
            mainText: '[00:00.00]line',
            wordByWordText: '[0,1000](0,1000,0)line',
            translationText: null,
            isPureMusic: false,
            chorusRanges: [],
        });
        autoMatchMock.mockResolvedValue({
            lyrics,
            source: 'qq',
            id: 201,
            qqMid: 'qq-mid',
            song: qqSong,
        });

        await loadOnlineSongLyrics(qqSong, null, null, {
            isCurrent: () => true,
            onLyrics: vi.fn(),
            onDone: vi.fn(),
        });

        expect(autoMatchMock).toHaveBeenCalledWith('Song', '', 1000, expect.objectContaining({
            preferredSource: 'qq',
            providerCandidate: expect.objectContaining({
                providerId: 'qq',
                song: qqSong,
                lyricsResult: expect.objectContaining({ lyrics, isPureMusic: false }),
            }),
        }));
        expect(saveLyricsStateMock).not.toHaveBeenCalled();
    });

    it('reports done before the auto-match search finishes, so audio never waits on it', async () => {
        // onDone is what releases playback. Auto-match asks every provider for a BETTER lyric file
        // and takes seconds when it finds none - an instrumental interlude matches nothing
        // anywhere. Holding the audio for an optional upgrade turned every such song change into
        // seconds of silence, and with a blended change the outgoing track has already ended by
        // then, so silence is all that is left.
        const lyrics = {
            lines: [{ startTime: 0, endTime: 1, fullText: 'line', words: [] }],
            isWordByWord: false,
        };
        lyricsMock.mockResolvedValue({
            lyrics,
            mainText: '[00:00.00]line',
            wordByWordText: null,
            translationText: null,
            isPureMusic: false,
            chorusRanges: [],
        });

        let finishAutoMatch = () => { };
        autoMatchMock.mockReturnValue(new Promise(resolve => {
            finishAutoMatch = () => resolve(null);
        }));

        const onDone = vi.fn();
        const onLyrics = vi.fn();
        const pending = loadOnlineSongLyrics(song, null, null, {
            isCurrent: () => true,
            onLyrics,
            onDone,
        });

        await vi.waitFor(() => expect(autoMatchMock).toHaveBeenCalled());

        // Still inside the search, and playback has already been let go.
        expect(onDone).toHaveBeenCalled();
        expect(onLyrics).toHaveBeenCalledWith(lyrics);

        finishAutoMatch();
        await pending;
    });
});

describe('instrumental tracks, once auto-match has settled them', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        songCacheMock.mockResolvedValue(null);
        loadLyricsStateMock.mockResolvedValue(null);
    });

    it('stores the verdict, so the search is not repeated on every play', async () => {
        // Without a stored answer `hasOnlineOverride` stays false, which is the flag that decides
        // whether to auto-match at all - so every instrumental in the library re-ran the full
        // QQ/NetEase/AMLLDB/Kugou search on every prefetch pass and every play, forever.
        lyricsMock.mockResolvedValue({
            lyrics: null,
            mainText: null,
            wordByWordText: null,
            translationText: null,
            isPureMusic: true,
            chorusRanges: [],
        });
        autoMatchMock.mockResolvedValue({ isPureMusic: true, source: 'netease', id: 1 });

        const onLyrics = vi.fn();
        await loadOnlineSongLyrics(song, null, null, {
            isCurrent: () => true,
            onLyrics,
            onDone: vi.fn(),
        });

        expect(saveLyricsStateMock).toHaveBeenCalledWith(song, expect.objectContaining({
            hasOnlineOverride: true,
            matchedIsPureMusic: true,
        }));
        expect(onLyrics).toHaveBeenCalledWith(null);
    });

    it('does not mistake a match from the track\'s own provider for an instrumental', async () => {
        // A MATCH object also carries `isPureMusic: false`, so the old `'isPureMusic' in bestMatch`
        // test was true for it too. A best match that came from the track's own provider fails the
        // override branch above, fell into this one, and had its perfectly good lyrics discarded.
        const lyrics = {
            lines: [{ startTime: 0, endTime: 1, fullText: 'line', words: [] }],
            isWordByWord: false,
        };
        lyricsMock.mockResolvedValue({
            lyrics,
            mainText: '[00:00.00]line',
            wordByWordText: null,
            translationText: null,
            isPureMusic: false,
            chorusRanges: [],
        });
        // song.sourceRef.providerId is 'kugou', so this is the same-provider case.
        autoMatchMock.mockResolvedValue({ lyrics, source: 'kugou', id: 'online-song', song, isPureMusic: false });

        const onLyrics = vi.fn();
        const onPureMusicChange = vi.fn();
        await loadOnlineSongLyrics(song, null, null, {
            isCurrent: () => true,
            onLyrics,
            onPureMusicChange,
            onDone: vi.fn(),
        });

        expect(onLyrics).toHaveBeenLastCalledWith(lyrics);
        expect(onPureMusicChange).not.toHaveBeenCalledWith(true);
        expect(saveLyricsStateMock).not.toHaveBeenCalled();
    });

    it('never takes an imported selection away from the listener', async () => {
        // A background auto-match can run over a track the listener imported lyrics for. Recording
        // the instrumental verdict must not replace their choice - resolveOnlineLyrics still
        // prefers the import.
        const imported = { lines: [], isWordByWord: false };
        const merged = markOnlineLyricsPureMusic({ lyricsSource: 'imported', importedLyrics: imported });

        expect(merged.lyricsSource).toBe('imported');
        expect(merged.importedLyrics).toBe(imported);
        expect(merged.matchedIsPureMusic).toBe(true);
    });
});
