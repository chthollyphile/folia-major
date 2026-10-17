import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import { BEAT_ACCENTS_VERSION } from '@/services/analysis/beatAccents';

// test/unit/beatFx/beatFxSource.test.ts
// A beat lookup that throws must answer "no beats" - so the frame falls back - and must not be
// remembered, so the next play of the track tries again. A list stored with accents carries them; one
// stored before them answers at once without, and brings them later. An online track not cached yet
// is read from the stream URL its playback resolved, and one with none yet says to ask again.

const { getTrackBeatGrid, getTrackBeatAccents } = vi.hoisted(() => ({
    getTrackBeatGrid: vi.fn(),
    getTrackBeatAccents: vi.fn(),
}));
vi.mock('@/services/analysis/beatGrid', () => ({ getTrackBeatGrid, getTrackBeatAccents }));
vi.mock('@/services/analysis/modelAvailability', () => ({ refreshModelAvailability: vi.fn(async () => undefined) }));
vi.mock('@/services/analysis/beatThis', () => ({ BEAT_THIS_SAMPLE_RATE: 22050, canRunBeatThis: () => true }));
const { readLocalTrackBytes, getPrefetchedData } = vi.hoisted(() => ({
    readLocalTrackBytes: vi.fn(async () => null as unknown),
    getPrefetchedData: vi.fn(() => null as unknown),
}));
vi.mock('@/services/analysis/trackAudio', () => ({
    readLocalTrackBytes,
    decodeAtRate: vi.fn(async (bytes: ArrayBuffer) => ({ bytes })),
    toMidSide: vi.fn(() => ({ mid: new Float32Array(4) })),
}));
vi.mock('@/services/prefetchService', () => ({ getPrefetchedData, isUrlValid: () => true }));
vi.mock('@/services/playbackRecovery/mediaCacheGuard', () => ({ isCacheableAudioResponse: () => true }));

const { loadBeatFxTrackBeats } = await import('@/services/beatFx/beatFxSource');

const makeSong = (id: string) => ({ id, sourceRef: { kind: 'online', providerId: 'kugou', mediaId: id } }) as unknown as SongResult;
const song = makeSong('throws');

describe('loadBeatFxTrackBeats', () => {
    beforeEach(() => {
        getTrackBeatGrid.mockReset();
        getTrackBeatAccents.mockReset();
        getTrackBeatAccents.mockResolvedValue(null);
    });

    it('answers no beats when the lookup throws, and retries on the next play', async () => {
        getTrackBeatGrid.mockRejectedValueOnce(new Error('idb gone'));
        const first = await loadBeatFxTrackBeats(song).beats;
        expect(first.source).toBe('none');
        expect(first.events).toEqual([]);
        expect(first.note).toContain('idb gone');

        // Let the eviction of the failed entry run.
        await Promise.resolve();
        getTrackBeatGrid.mockResolvedValueOnce({ beats: [0.5, 1], downbeats: [0.5] });
        const second = await loadBeatFxTrackBeats(song).beats;
        expect(second.source).toBe('beat_this');
        expect(second.events.length).toBeGreaterThan(0);
        expect(getTrackBeatGrid).toHaveBeenCalledTimes(2);
        // small0 only: the beat FX never ask for, read or share automix's final0 lists.
        for (const call of getTrackBeatGrid.mock.calls) expect(call[2]).toEqual({ model: 'beat_this_small' });
    });

    const ACCENTS = { v: BEAT_ACCENTS_VERSION, impact: [0.2, 1], low: [0.8, 0.2], mid: [0.1, 0.4], high: [0.1, 0.4], rhythmic: [1, 1], pulse: [1, 1], trackScale: 0.7 };

    it('carries stored accents on the events', async () => {
        getTrackBeatGrid.mockResolvedValueOnce({ beats: [0.5, 1], downbeats: [0.5], accents: ACCENTS });
        const answer = await loadBeatFxTrackBeats(makeSong('accented')).beats;
        expect(answer.trackScale).toBe(0.7);
        expect(answer.accented).toBeUndefined();
        expect(answer.events.map(event => [event.impact, event.barPos])).toEqual([[0.2, 0], [1, 1]]);
        expect(getTrackBeatAccents).not.toHaveBeenCalled();
    });

    it('answers a list without accents at once, and the accented one once measured', async () => {
        getTrackBeatGrid.mockResolvedValueOnce({ beats: [0.5, 1], downbeats: [0.5] });
        getTrackBeatAccents.mockResolvedValueOnce(ACCENTS);
        const answer = await loadBeatFxTrackBeats(makeSong('late')).beats;
        expect(answer.trackScale).toBe(1);
        expect(answer.events.every(event => event.impact === undefined && event.barPos === undefined)).toBe(true);
        const accented = await answer.accented;
        expect(accented?.trackScale).toBe(0.7);
        expect(accented?.events.map(event => event.tone?.low)).toEqual([0.8, 0.2]);
    });

    describe('an online track not cached yet', () => {
        const readingGrid = async (_key: string, readMid: () => Promise<Float32Array | null>) => (
            await readMid() ? { beats: [0.5, 1], downbeats: [0.5] } : null
        );
        beforeEach(() => {
            vi.stubGlobal('navigator', { gpu: {} });
            readLocalTrackBytes.mockResolvedValue(null);
        });

        it('reads the stream URL its playback resolved', async () => {
            getTrackBeatGrid.mockImplementationOnce(readingGrid);
            getPrefetchedData.mockReturnValueOnce({ audioUrl: 'https://stream.example/a.m4a', audioUrlFetchedAt: Date.now() });
            const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => ({ size: 9, arrayBuffer: async () => new ArrayBuffer(9) }) }));
            vi.stubGlobal('fetch', fetchMock);
            const answer = await loadBeatFxTrackBeats(makeSong('streamed')).beats;
            expect(fetchMock).toHaveBeenCalledWith('https://stream.example/a.m4a');
            expect(answer.source).toBe('beat_this');
            vi.unstubAllGlobals();
        });

        it('says to ask again while playback has no URL for it yet', async () => {
            getTrackBeatGrid.mockImplementationOnce(readingGrid);
            getPrefetchedData.mockReturnValueOnce(null);
            const answer = await loadBeatFxTrackBeats(makeSong('unresolved')).beats;
            expect(answer.source).toBe('none');
            expect(answer.retry).toBe(true);
            vi.unstubAllGlobals();
        });
    });
});
