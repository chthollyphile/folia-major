import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/analysis/beatGrid.test.ts
// A whole track's beats per model - final0 for automix, small0 for the beat FX: stored, joined while in
// flight, run once, and never crossed between the two.

const store = new Map<string, unknown>();
vi.mock('@/services/db', () => ({
    getFromCache: vi.fn(async (key: string) => store.get(key) ?? null),
    saveToCache: vi.fn(async (key: string, data: unknown) => {
        store.set(key, data);
    }),
}));

const { analyseBeatGrid, canRunBeatThis } = vi.hoisted(() => ({
    analyseBeatGrid: vi.fn(),
    canRunBeatThis: vi.fn(() => true),
}));
vi.mock('@/services/analysis/beatThis', () => ({ analyseBeatGrid, canRunBeatThis }));
vi.mock('@/services/automix/analysisOffThread', () => ({ melSpectrogramOffThread: vi.fn(async () => ({ data: new Float32Array(0), frames: 0 })) }));

const { readStoredBeatGrid, storeBeatGrid, getTrackBeatGrid } = await import('@/services/analysis/beatGrid');

const GRID = { beats: [0.5, 1, 1.5, 2], downbeats: [0.5, 2] };
const mid = () => Promise.resolve(new Float32Array(4));

describe('beat grid store', () => {
    beforeEach(() => store.clear());

    it('round-trips a beat list under the track key', async () => {
        await storeBeatGrid('song-1', GRID);
        expect(await readStoredBeatGrid('song-1')).toEqual(GRID);
        expect(await readStoredBeatGrid('song-2')).toBeNull();
    });

    it('does not keep an empty list', async () => {
        await storeBeatGrid('song-1', { beats: [], downbeats: [] });
        expect(store.size).toBe(0);
    });

    it('ignores an entry from another version or a malformed one', async () => {
        store.set('beat_this_grid_song-1', { version: 0, beats: [1], downbeats: [] });
        expect(await readStoredBeatGrid('song-1')).toBeNull();
        store.set('beat_this_grid_song-1', { version: 1, beats: [1, 'x'], downbeats: [] });
        expect(await readStoredBeatGrid('song-1')).toBeNull();
    });
});

describe('getTrackBeatGrid', () => {
    beforeEach(() => {
        store.clear();
        analyseBeatGrid.mockReset();
        canRunBeatThis.mockReturnValue(true);
    });

    it('answers a stored list without decoding or running the model', async () => {
        await storeBeatGrid('song-1', GRID);
        const readMid = vi.fn(mid);
        expect(await getTrackBeatGrid('song-1', readMid)).toEqual(GRID);
        expect(readMid).not.toHaveBeenCalled();
        expect(analyseBeatGrid).not.toHaveBeenCalled();
    });

    it('runs once for two callers asking at the same time, and stores the answer', async () => {
        analyseBeatGrid.mockResolvedValue(GRID);
        const [a, b] = await Promise.all([
            getTrackBeatGrid('song-1', mid),
            getTrackBeatGrid('song-1', mid, { cpuFallback: true }),
        ]);
        expect(a).toEqual(GRID);
        expect(b).toEqual(GRID);
        expect(analyseBeatGrid).toHaveBeenCalledTimes(1);
        expect(await readStoredBeatGrid('song-1')).toEqual(GRID);
    });

    it('lets a caller allowed the CPU run again after a GPU-only run came back empty', async () => {
        analyseBeatGrid.mockResolvedValueOnce(null).mockResolvedValueOnce(GRID);
        const [gpuOnly, withCpu] = await Promise.all([
            getTrackBeatGrid('song-1', mid),
            getTrackBeatGrid('song-1', mid, { cpuFallback: true }),
        ]);
        expect(gpuOnly).toBeNull();
        expect(withCpu).toEqual(GRID);
        expect(analyseBeatGrid.mock.calls.map(call => call[1])).toEqual([
            { cpuFallback: false, model: 'beat_this' },
            { cpuFallback: true, model: 'beat_this' },
        ]);
    });

    it('never starts a run without the model, but still reads a stored list', async () => {
        canRunBeatThis.mockReturnValue(false);
        expect(await getTrackBeatGrid('song-1', mid)).toBeNull();
        await storeBeatGrid('song-1', GRID);
        expect(await getTrackBeatGrid('song-1', mid)).toEqual(GRID);
        expect(analyseBeatGrid).not.toHaveBeenCalled();
    });

    it('keeps the two models apart: neither reads, joins or stores as the other', async () => {
        await storeBeatGrid('song-1', GRID);
        const SMALL = { beats: [0.6, 1.1], downbeats: [0.6] };
        analyseBeatGrid.mockResolvedValue(SMALL);
        expect(await getTrackBeatGrid('song-1', mid, { model: 'beat_this_small' })).toEqual(SMALL);
        expect(analyseBeatGrid).toHaveBeenCalledTimes(1);
        expect(await readStoredBeatGrid('song-1')).toEqual(GRID);
        expect(await readStoredBeatGrid('song-1', 'beat_this_small')).toEqual(SMALL);
        expect([...store.keys()].sort()).toEqual(['beat_this_grid_song-1', 'beat_this_small_grid_song-1']);
    });

    it('runs small0 on the GPU only, whatever the caller allows', async () => {
        analyseBeatGrid.mockResolvedValue(GRID);
        await getTrackBeatGrid('song-2', mid, { model: 'beat_this_small', cpuFallback: true });
        expect(analyseBeatGrid.mock.calls[0][1]).toEqual({ cpuFallback: false, model: 'beat_this_small' });
    });
});
