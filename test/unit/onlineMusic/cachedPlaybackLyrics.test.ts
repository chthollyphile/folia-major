import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Line, LyricData, SongResult } from '@/types';
import { ensureLyricDataRenderHints } from '@/utils/lyrics/renderHints';

// test/unit/onlineMusic/cachedPlaybackLyrics.test.ts
// The playback paths' read of a song's cached lyrics: an entry saved before chorus origins (#1333) is fetched
// again where it is what plays, and kept when the fetch brings nothing.

const mocks = vi.hoisted(() => ({
    cached: vi.fn(),
    getLyrics: vi.fn(),
    state: vi.fn(),
    save: vi.fn(),
}));

vi.mock('@/services/onlineMusic/resourceCache', () => ({ getSongCacheWithLegacyMigration: (...args: unknown[]) => mocks.cached(...args) }));
vi.mock('@/services/onlineMusic/omni', () => ({ omni: { getLyrics: (...args: unknown[]) => mocks.getLyrics(...args) } }));
vi.mock('@/utils/onlineLyricsState', () => ({ loadOnlineLyricsState: (...args: unknown[]) => mocks.state(...args) }));
vi.mock('@/services/db', () => ({ saveToCache: (...args: unknown[]) => mocks.save(...args) }));

import { readCachedPlaybackLyrics, resetCachedPlaybackLyricsRefreshes } from '@/services/onlineMusic/cachedPlaybackLyrics';

const song: SongResult = {
    id: 'HASH', name: 'Song', artists: [], album: { id: 1, name: 'Album' }, durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'kugou', mediaId: 'HASH' },
};
const KEY = 'lyric_online:kugou:HASH';

const line = (startTime: number, extra: Partial<Line> = {}): Line => ({
    startTime, endTime: startTime + 4, fullText: `l${startTime}`, words: [{ text: `l${startTime}`, startTime, endTime: startTime + 4 }], ...extra,
});
const lyricsOf = (lines: Line[]): LyricData => ensureLyricDataRenderHints({ lines, isWordByWord: false })!;

const stale = lyricsOf([line(0), line(4, { isChorus: true, chorusEffect: 'bars' })]);
const fresh = lyricsOf([line(0), line(4, { isChorus: true, chorusEffect: 'bars', chorusOrigin: 'source' })]);

describe('readCachedPlaybackLyrics', () => {
    beforeEach(() => {
        resetCachedPlaybackLyricsRefreshes();
        vi.clearAllMocks();
        mocks.state.mockResolvedValue(null);
        mocks.save.mockResolvedValue(undefined);
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('answers a current entry as it is, without asking the source', async () => {
        mocks.cached.mockResolvedValue(fresh);
        await expect(readCachedPlaybackLyrics(song)).resolves.toBe(fresh);
        expect(mocks.getLyrics).not.toHaveBeenCalled();
    });

    it('answers an old entry as it is, without a fetch, to a reader that fetches the lyrics itself', async () => {
        mocks.cached.mockResolvedValue(stale);
        await expect(readCachedPlaybackLyrics(song, { refresh: false })).resolves.toBe(stale);
        expect(mocks.getLyrics).not.toHaveBeenCalled();
    });

    it('fetches an old entry again and saves what comes over it', async () => {
        mocks.cached.mockResolvedValue(stale);
        mocks.getLyrics.mockResolvedValue({ lyrics: fresh, isPureMusic: false });

        await expect(readCachedPlaybackLyrics(song)).resolves.toMatchObject({ lines: [{}, { chorusOrigin: 'source' }] });
        expect(mocks.save).toHaveBeenCalledWith(KEY, expect.objectContaining({ lines: expect.any(Array) }));
    });

    it('keeps the old entry when the fetch fails (offline) or brings none, and does not ask again this session', async () => {
        mocks.cached.mockResolvedValue(stale);
        mocks.getLyrics.mockRejectedValueOnce(new Error('offline'));

        await expect(readCachedPlaybackLyrics(song)).resolves.toBe(stale);
        await expect(readCachedPlaybackLyrics(song)).resolves.toBe(stale);
        expect(mocks.getLyrics).toHaveBeenCalledTimes(1);
        expect(mocks.save).not.toHaveBeenCalled();

        resetCachedPlaybackLyricsRefreshes();
        mocks.getLyrics.mockResolvedValueOnce({ lyrics: null, isPureMusic: false });
        await expect(readCachedPlaybackLyrics(song)).resolves.toBe(stale);
        expect(mocks.save).not.toHaveBeenCalled();
    });

    it.each([
        ['a chosen lyric', { hasOnlineOverride: true, onlineOverrideLyrics: fresh }],
        ['an imported lyric', { lyricsSource: 'imported', importedLyrics: fresh }],
    ])('leaves an old entry alone under %s, which it does not stand for', async (_label, state) => {
        mocks.cached.mockResolvedValue(stale);
        mocks.state.mockResolvedValue(state);

        await expect(readCachedPlaybackLyrics(song)).resolves.toBe(stale);
        expect(mocks.getLyrics).not.toHaveBeenCalled();
    });

    it('shows the old entry after a while and lets a slow fetch save its lyrics when they come', async () => {
        vi.useFakeTimers();
        mocks.cached.mockResolvedValue(stale);
        let finish!: (value: unknown) => void;
        mocks.getLyrics.mockReturnValue(new Promise(resolve => { finish = resolve; }));

        const read = readCachedPlaybackLyrics(song);
        await vi.advanceTimersByTimeAsync(4000);
        await expect(read).resolves.toBe(stale);

        finish({ lyrics: fresh, isPureMusic: false });
        await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledWith(KEY, expect.anything()));
    });

    // The paths that load lyrics to play them read the cache through it (a path that went back to the plain read
    // would show old entries without a chorus tick again).
    it.each([
        'src/services/onlinePlayback.ts',
        'src/services/prefetchService.ts',
        'src/components/app/playback/start/useLibraryPlaybackController.ts',
        'src/components/app/playback/restore/restorePlaybackSource.ts',
    ])('is how %s reads cached lyrics to play them', file => {
        const text = readFileSync(path.resolve(file), 'utf8');
        expect(text).toContain('readCachedPlaybackLyrics(');
    });
});
