import { describe, expect, it } from 'vitest';
import type { SongResult } from '@/types';
import { playbackKindOfSong, resolvePlaybackRoute, type HifiRouteContext } from '@/services/hifi/hifiEligibility';

// test/unit/hifi/hifiEligibility.test.ts
// Which songs the HiFi engine may play, and every gate that keeps a song on the Web engine.

const song = (fields: Record<string, unknown>) => ({ id: 1, name: 'Song', ar: [], al: {}, dt: 0, ...fields }) as unknown as SongResult;

const localSong = song({ isLocal: true, localRef: { songId: 'local-1' } });
const navidromeSong = song({ isNavidrome: true, navidromeData: { id: 'nd-1' } });
const stageSong = song({ sourceRef: { kind: 'stage', mediaId: 'stage-1' } });
const onlineSong = song({ sourceRef: { kind: 'online', providerId: 'netease', mediaId: '1' } });

const open: HifiRouteContext = {
    supported: true,
    enabled: true,
    navidromeEnabled: true,
    runtimeAvailable: true,
    circuitOpen: false,
    forcedWeb: false,
};

describe('playbackKindOfSong', () => {
    it('tells local, Navidrome, Stage and online songs apart', () => {
        expect(playbackKindOfSong(localSong)).toBe('local');
        expect(playbackKindOfSong(navidromeSong)).toBe('navidrome');
        expect(playbackKindOfSong(stageSong)).toBe('stage');
        expect(playbackKindOfSong(onlineSong)).toBe('online');
    });

    it('counts a Stage song as Stage even when it also carries local fields', () => {
        expect(playbackKindOfSong(song({ isStage: true, isLocal: true, localRef: { songId: 'x' } }))).toBe('stage');
    });
});

describe('resolvePlaybackRoute', () => {
    it('sends local songs to HiFi and Navidrome songs only while that switch is on', () => {
        expect(resolvePlaybackRoute('local', open)).toBe('hifi');
        expect(resolvePlaybackRoute('navidrome', open)).toBe('hifi');
        expect(resolvePlaybackRoute('navidrome', { ...open, navidromeEnabled: false })).toBe('web');
        expect(resolvePlaybackRoute('local', { ...open, navidromeEnabled: false })).toBe('hifi');
    });

    it('keeps online and Stage songs on the Web engine', () => {
        expect(resolvePlaybackRoute('online', open)).toBe('web');
        expect(resolvePlaybackRoute('stage', open)).toBe('web');
    });

    it.each([
        ['unsupported', { supported: false }],
        ['disabled', { enabled: false }],
        ['without a runtime', { runtimeAvailable: false }],
        ['with the circuit open', { circuitOpen: true }],
        ['after a per-song fallback', { forcedWeb: true }],
    ] as const)('falls back to Web when %s', (_label, gate) => {
        expect(resolvePlaybackRoute('local', { ...open, ...gate })).toBe('web');
        expect(resolvePlaybackRoute('navidrome', { ...open, ...gate })).toBe('web');
    });
});
