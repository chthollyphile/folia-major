import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import type { PlaybackRepresentation } from '@/types/playbackRecovery';

// test/unit/automix/transcodeAnalysisKey.test.ts
// A track the browser cannot play is transcoded, and from that moment its analysis key names the
// transcode (representationRegistry.ts). Pinned here: a request made after the transcode registers is
// not dropped by a scope set before it or after it, the log says what became of the original rather
// than "never requested", and the tail a deck played completes the head-only profile of the original -
// the only key a head-only profile is ever made under. A Navidrome track, because a head-only profile
// comes from a read of a stream's front; a local file is always read whole.

const { stored, saveToCache } = vi.hoisted(() => ({
    stored: new Map<string, unknown>(),
    saveToCache: vi.fn(async () => {}),
}));

vi.mock('@/services/db', () => ({
    getFromCache: async (key: string) => stored.get(key) ?? null,
    saveToCache,
}));

const {
    clearTrackProfileRuntime,
    describeProfileState,
    ensureTrackProfile,
    recordPlayedTail,
    setAnalysisScope,
} = await import('@/services/automix/profileService');
const { TRACK_PROFILE_VERSION } = await import('@/services/automix/trackProfile');
const { clearPlaybackRepresentationsForTests, registerPlaybackRepresentation } = await import('@/services/playbackRecovery/representationRegistry');

const song = {
    id: 'x',
    name: 'X',
    artists: [],
    album: { id: 'album', name: 'Album' },
    durationMs: 200_000,
    isNavidrome: true,
    navidromeData: { id: 'x' },
    sourceRef: { kind: 'navidrome', mediaId: 'x' },
    playbackSourceRevision: 'rev-1',
} as unknown as SongResult;

const transcode: PlaybackRepresentation = {
    songKey: 'navidrome:x',
    sourceRevision: 'rev-1',
    representationId: 'transcode:abc',
    kind: 'transcoded',
    url: 'folia-transcode://abc',
    mimeType: 'audio/flac',
    timelineOffsetSec: 0,
};

/** A head-only profile of the original, stored by an earlier read of the stream's front. */
const storeHeadOnlyOriginal = () => stored.set('automix_profile_navidrome:x', {
    version: TRACK_PROFILE_VERSION, partial: true, duration: 40, gridless: true, bpm: null, loudness: -9,
});

const analyse = () => ensureTrackProfile({ song, wantGrid: false, audioUrl: null, enableMediaCache: false });

describe('the analysis of a track that is transcoded', () => {
    let fetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        clearTrackProfileRuntime();
        clearPlaybackRepresentationsForTests();
        stored.clear();
        saveToCache.mockClear();
        fetch = vi.fn(async () => new Response(new Uint8Array(64 * 1024)));
        vi.stubGlobal('fetch', fetch);
        // Nothing to decode with: the analysis ends at the decode, after the step under test.
        vi.stubGlobal('window', globalThis);
        vi.spyOn(console, 'log').mockImplementation(() => { });
        vi.spyOn(console, 'warn').mockImplementation(() => { });
    });

    afterEach(() => {
        clearPlaybackRepresentationsForTests();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('reads the transcode when asked after it registers, under a scope set before it', async () => {
        setAnalysisScope([song]);
        registerPlaybackRepresentation(transcode);

        await analyse();

        expect(fetch).toHaveBeenCalledWith('folia-transcode://abc');
        expect(describeProfileState(song)).not.toMatch(/^dropped/);
    });

    // Keyed by the analysis key, a scope set after the transcode names the transcode while the request
    // is checked by song - or the other way round. Either half alone drops it.
    it('reads the transcode when the scope is set again after it registers', async () => {
        registerPlaybackRepresentation(transcode);
        setAnalysisScope([song]);

        await analyse();

        expect(fetch).toHaveBeenCalledWith('folia-transcode://abc');
        expect(describeProfileState(song)).not.toMatch(/^dropped/);
    });

    it('says what became of the original until the transcode is measured', async () => {
        storeHeadOnlyOriginal();
        setAnalysisScope([song]);
        await analyse();
        expect(describeProfileState(song)).toBe('measured (head only)');

        registerPlaybackRepresentation(transcode);

        expect(describeProfileState(song)).toBe('nothing measured from its transcode (the original file: measured (head only))');
    });

    it('completes the original\'s head-only profile from a deck that played the transcode', async () => {
        storeHeadOnlyOriginal();
        setAnalysisScope([song]);
        await analyse();
        registerPlaybackRepresentation(transcode);
        const hop = 0.5;
        const heard = Array.from({ length: 200 / hop }, () => -20);

        recordPlayedTail(song, heard, hop, 200, transcode.url);

        expect(saveToCache).toHaveBeenCalledExactlyOnceWith(
            'automix_profile_navidrome:x',
            expect.objectContaining({ partial: false, duration: 200 }),
        );
    });

    it('forgets what the requests came to when the runtime is cleared', async () => {
        setAnalysisScope([]);
        await analyse();
        expect(describeProfileState(song)).toMatch(/^dropped/);

        clearTrackProfileRuntime();

        expect(describeProfileState(song)).toBe('never requested');
    });
});
