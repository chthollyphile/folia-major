import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';

// test/unit/volumeBalance/balanceRecords.test.ts
// What the balance keeps of each song: a clear stays cleared, a silent file is no reading.

const state = vi.hoisted(() => ({
    store: new Map<string, unknown>(),
    saved: [] as string[],
    /** Holds every cache read until it is let go. */
    gate: Promise.resolve() as Promise<void>,
    profile: null as unknown,
    measured: null as null | ((measured: unknown) => void),
}));

vi.mock('@/services/db', () => ({
    getFromCache: async (key: string) => {
        await state.gate;
        return state.store.get(key) ?? null;
    },
    saveToCache: async (key: string, data: unknown) => {
        state.saved.push(key);
        state.store.set(key, data);
    },
}));
vi.mock('@/utils/appPlaybackGuards', () => ({ getPlaybackSongKey: (song: { id: string }) => song.id }));
vi.mock('@/services/automix/profileService', () => ({
    getTrackProfile: () => null,
    onProgramMeasured: (listener: (measured: unknown) => void) => { state.measured = listener; },
    readStoredTrackProfile: async () => state.profile,
}));
vi.mock('@/services/automix/trackProfile', () => ({ programIsWholeTrack: (profile: unknown) => Boolean(profile), TRACK_PROFILE_VERSION: 10 }));
vi.mock('@/services/playbackRecovery/representationRegistry', () => ({ getPlaybackAnalysisKey: (song: { id: string }) => song.id }));
vi.mock('@/services/wholeSongCheck', () => ({ whyNotTheSongPlayed: () => null }));

const { clearBalanceRuntime, getBalanceRecord, loadBalanceRecord, noteWholeReading, typicalGains } = await import('@/services/volumeBalance/balanceRecords');

const song = (id: string) => ({ id, name: id }) as SongResult;
const gated = () => {
    let open = () => undefined as void;
    state.gate = new Promise<void>((resolve) => { open = resolve; });
    return () => open();
};

describe('volume balance records', () => {
    beforeEach(() => {
        clearBalanceRuntime();
        state.store.clear();
        state.saved = [];
        state.gate = Promise.resolve();
        state.profile = null;
    });

    it('takes an automix profile over in memory without saving it', async () => {
        state.profile = { version: 10, programLoudness: -9, peak: 1, duration: 200 };
        await loadBalanceRecord(song('A'));
        expect(getBalanceRecord(song('A'))).toEqual({ file: { loudness: -9, peak: 1 } });
        expect(state.saved).toEqual([]);
    });

    it('writes nothing back from a load or a typical save a clear overtook', async () => {
        state.store.set('volume_balance_B', { file: { loudness: -9, peak: 1 } });
        const open = gated();
        const load = loadBalanceRecord(song('B'));
        noteWholeReading('C', -4);
        clearBalanceRuntime();
        state.store.clear();
        open();
        await load;
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(getBalanceRecord(song('B'))).toBeNull();
        expect(state.saved).toEqual([]);
        // The next load reads the cleared cache afresh.
        await loadBalanceRecord(song('B'));
        expect(getBalanceRecord(song('B'))).toBeNull();
    });

    it('keeps no record and no typical gain of a silent file', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        state.measured!({ key: 'S', song: song('S'), loudness: -90, peak: 0.001, queuedAt: 0, startedAt: 0, bytesAt: 0, decodedAt: 0, measuredAt: 0, profiled: Promise.resolve(0) });
        state.profile = { version: 10, programLoudness: -90, peak: 0.001, duration: 200 };
        await loadBalanceRecord(song('S'));
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(getBalanceRecord(song('S'))).toBeNull();
        expect(typicalGains()).toEqual([]);
        expect(state.saved).toEqual([]);
    });
});
