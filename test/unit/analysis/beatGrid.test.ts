import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/analysis/beatGrid.test.ts
// A whole track's beats - final0's, shared by automix and the beat FX: stored, joined while in flight,
// run once, with the accents a GPU run measures alongside.

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
// The real spectrogram helpers, for the accents measured alongside the beats.
vi.mock('@/services/analysis/beatThis', async () => ({
    ...await vi.importActual<object>('@/services/analysis/beatThis'),
    analyseBeatGrid,
    canRunBeatThis,
}));
vi.mock('@/services/automix/analysisOffThread', () => ({ melSpectrogramOffThread: vi.fn(async () => ({ data: new Float32Array(0), frames: 0 })) }));

const { readStoredBeatGrid, storeBeatGrid, getTrackBeatGrid, getTrackBeatAccents } = await import('@/services/analysis/beatGrid');

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
            { cpuFallback: false, percussive: true, urgency: 'background', key: 'song-1' },
            { cpuFallback: true, percussive: true, urgency: 'background', key: 'song-1' },
        ]);
    });

    it('stored only (智能动感模式 cached): a stored list or a joined run, never a run of its own', async () => {
        const readMid = vi.fn(mid);
        expect(await getTrackBeatGrid('song-1', readMid, { storedOnly: true })).toBeNull();
        expect(readMid).not.toHaveBeenCalled();
        expect(analyseBeatGrid).not.toHaveBeenCalled();
        // automix's run in flight is waited for and used, even one allowed the CPU.
        analyseBeatGrid.mockResolvedValue(GRID);
        const [automix, beatFx] = await Promise.all([
            getTrackBeatGrid('song-2', mid, { cpuFallback: true }),
            getTrackBeatGrid('song-2', readMid, { storedOnly: true }),
        ]);
        expect(beatFx).toEqual(automix);
        expect(analyseBeatGrid).toHaveBeenCalledTimes(1);
        expect(readMid).not.toHaveBeenCalled();
        await storeBeatGrid('song-1', GRID);
        expect(await getTrackBeatGrid('song-1', readMid, { storedOnly: true })).toEqual(GRID);
    });

    it('never starts a run without the model, but still reads a stored list', async () => {
        canRunBeatThis.mockReturnValue(false);
        expect(await getTrackBeatGrid('song-1', mid)).toBeNull();
        await storeBeatGrid('song-1', GRID);
        expect(await getTrackBeatGrid('song-1', mid)).toEqual(GRID);
        expect(analyseBeatGrid).not.toHaveBeenCalled();
    });

    it('reads no list small0 stored when the beat FX ran it', async () => {
        store.set('beat_this_small_grid_song-1', { version: 1, ...GRID });
        expect(await readStoredBeatGrid('song-1')).toBeNull();
        analyseBeatGrid.mockResolvedValue(GRID);
        expect(await getTrackBeatGrid('song-1', mid)).toEqual(GRID);
        expect(analyseBeatGrid).toHaveBeenCalledTimes(1);
    });

    it('gates the accents on the run\'s percussive energy, and keeps the energy out of the grid', async () => {
        const beats = Array.from({ length: 48 }, (_, index) => index * 0.25);
        const downbeats = beats.filter((_, index) => index % 4 === 0);
        // 50 frames a second; the first second (bar) has no percussive energy.
        const percussive = new Float32Array(12 * 50).fill(0.3, 50);
        const total = new Float32Array(12 * 50).fill(1);
        analyseBeatGrid.mockResolvedValue({ beats, downbeats, percussive: { percussive, total } });
        const found = await getTrackBeatGrid('song-3', mid);
        expect(found).not.toHaveProperty('percussive');
        expect(found?.accents?.rhythmic.slice(0, 5)).toEqual([0, 0, 0, 0, 1]);
        const stored = await readStoredBeatGrid('song-3');
        expect(stored).not.toHaveProperty('percussive');
        expect(stored?.accents?.rhythmic.slice(0, 5)).toEqual([0, 0, 0, 0, 1]);
    });
});

describe('beat accents', () => {
    beforeEach(() => {
        store.clear();
        analyseBeatGrid.mockReset();
        canRunBeatThis.mockReturnValue(true);
    });

    const copy = () => ({ beats: [...GRID.beats], downbeats: [...GRID.downbeats] });

    const energy = () => ({ percussive: new Float32Array(150).fill(0.5), total: new Float32Array(150).fill(1) });

    it('measures and stores them with a GPU run (the one with the energy), never with a CPU one', async () => {
        analyseBeatGrid.mockImplementation(async () => ({ ...copy(), percussive: energy() }));
        const gpu = await getTrackBeatGrid('song-1', mid);
        expect(gpu?.accents?.impact).toHaveLength(GRID.beats.length);
        expect((await readStoredBeatGrid('song-1'))?.accents).toEqual(gpu?.accents);
        analyseBeatGrid.mockImplementation(async () => copy());
        const cpu = await getTrackBeatGrid('song-2', mid, { cpuFallback: true });
        expect(cpu?.accents).toBeUndefined();
        expect((store.get('beat_this_grid_song-2') as { accents?: unknown }).accents).toBeUndefined();
    });

    it('leaves off stored accents that do not fit the list, keeping the beats', async () => {
        store.set('beat_this_grid_song-1', {
            version: 1,
            ...copy(),
            accents: { v: 1, impact: [1], low: [1], mid: [0], high: [0], trackScale: 1 },
        });
        expect(await readStoredBeatGrid('song-1')).toEqual(GRID);
    });

    it('fills them in for a list stored without, once per key', async () => {
        await storeBeatGrid('song-1', copy());
        const readMid = vi.fn(mid);
        const [a, b] = await Promise.all([
            getTrackBeatAccents('song-1', copy(), readMid),
            getTrackBeatAccents('song-1', copy(), readMid),
        ]);
        expect(a).toBe(b);
        expect(readMid).toHaveBeenCalledTimes(1);
        expect((await readStoredBeatGrid('song-1'))?.accents).toEqual(a);
        // final0 runs again once, for its confidence in the stored beats and the percussive energy.
        expect(analyseBeatGrid.mock.calls.map(call => call[1])).toEqual([{ percussive: true, urgency: 'onScreen' }]);
    });

    it('does not file accents against a list replaced meanwhile, or without the bytes', async () => {
        await storeBeatGrid('song-1', { beats: [9, 10], downbeats: [9] });
        expect(await getTrackBeatAccents('song-1', copy(), mid)).not.toBeNull();
        expect((await readStoredBeatGrid('song-1'))?.accents).toBeUndefined();
        expect(await getTrackBeatAccents('song-2', copy(), async () => null)).toBeNull();
    });
});
