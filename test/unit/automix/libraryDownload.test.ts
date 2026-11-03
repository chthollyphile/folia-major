import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';

// test/unit/automix/libraryDownload.test.ts
// What the analyser downloads of a library server's stream (Navidrome): the front only, whether song
// caching is on or off - nothing keeps the stream, so a whole read would be a second download of every
// track - and no second range request to a server that refused the first: a transcoding server
// refuses every time, and each ask starts a transcode.

const { saveAudioBlob } = vi.hoisted(() => ({ saveAudioBlob: vi.fn(async () => {}) }));

vi.mock('@/services/db', () => ({ getFromCache: async () => null, saveToCache: async () => {} }));
vi.mock('@/services/audioCache', async importOriginal => ({
    ...await importOriginal<typeof import('@/services/audioCache')>(),
    saveAudioBlob,
}));

const { describeProfileState, ensureTrackProfile, setAnalysisScope } = await import('@/services/automix/profileService');

const URL_OF = (id: string) => `https://navi.test/rest/stream?id=${id}`;

const navidrome = (id: string): SongResult => ({
    id,
    name: id,
    artists: [],
    album: { id: 'album', name: 'Album' },
    durationMs: 200_000,
    isNavidrome: true,
    navidromeData: { id },
    sourceRef: { kind: 'navidrome', mediaId: id },
} as unknown as SongResult);

/** A server answering every request with a whole (small, unusable) file and 200, as a transcoder does. */
const answerWhole = () => vi.fn(async () => new Response(new Uint8Array(64 * 1024), {
    status: 200,
    headers: { 'content-type': 'audio/mpeg' },
}));

const analyse = (song: SongResult, enableMediaCache: boolean) => {
    setAnalysisScope([song]);
    return ensureTrackProfile({ song, audioUrl: URL_OF(String(song.id)), wantGrid: false, enableMediaCache });
};

describe('reading a Navidrome stream for analysis', () => {
    beforeEach(() => {
        saveAudioBlob.mockClear();
        vi.stubGlobal('window', globalThis);
        vi.spyOn(console, 'log').mockImplementation(() => { });
        vi.spyOn(console, 'warn').mockImplementation(() => { });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('asks for the front only, and not again once the server refused', async () => {
        const fetch = answerWhole();
        vi.stubGlobal('fetch', fetch);
        const song = navidrome('off');

        await analyse(song, false);
        await analyse(song, false);

        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch.mock.calls[0]).toEqual([URL_OF('off'), { headers: { Range: expect.stringMatching(/^bytes=0-\d+$/) } }]);
        expect(describeProfileState(song)).toMatch(/^skipped: the server would not serve a partial range/);
    });

    it('asks for the front only with song caching on too, and keeps no copy', async () => {
        const fetch = answerWhole();
        vi.stubGlobal('fetch', fetch);

        await analyse(navidrome('on'), true);

        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch.mock.calls[0]).toEqual([URL_OF('on'), { headers: { Range: expect.stringMatching(/^bytes=0-\d+$/) } }]);
        expect(saveAudioBlob).not.toHaveBeenCalled();
    });
});
