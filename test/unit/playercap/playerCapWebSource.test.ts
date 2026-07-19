import { describe, expect, it } from 'vitest';
import { foldPlayerCapConnectionStatus, playerCapToWebLyricSource } from '@/utils/playerCapWebSource';
import type { PlayerCapSessionState } from '@/utils/playerCapSession';

// test/unit/playercap/playerCapWebSource.test.ts
// PlayerCap session → neutral WebLyricSource: connection folding, track seed = title, and the
// structurally-identical clock / playback state / lyrics passing through unchanged.

const session = (over: Partial<PlayerCapSessionState> = {}): PlayerCapSessionState => ({
    activePlayer: 'foobar2000',
    connectionStatus: 'connected',
    playerState: 'playing',
    track: { name: 'Song', artist: 'Artist', coverUrl: 'http://x/cover.jpg', title: 'Song · Artist' },
    lyrics: null,
    clock: { positionSec: 12, durationSec: 200, anchoredAtMs: 1000, playing: true },
    ...over,
});

describe('foldPlayerCapConnectionStatus', () => {
    it('folds the 6-state enum into the neutral 5-state one', () => {
        expect(foldPlayerCapConnectionStatus('connected')).toBe('connected');
        expect(foldPlayerCapConnectionStatus('probing')).toBe('connecting');
        expect(foldPlayerCapConnectionStatus('connecting')).toBe('connecting');
        expect(foldPlayerCapConnectionStatus('disconnected')).toBe('error');
        expect(foldPlayerCapConnectionStatus('unreachable')).toBe('error');
        expect(foldPlayerCapConnectionStatus('idle')).toBe('idle');
    });
});

describe('playerCapToWebLyricSource', () => {
    const getCurrentTimeSec = (nowMs: number) => nowMs / 1000;

    it('maps track title to the visual seed and passes the clock through by reference', () => {
        const s = session();
        const web = playerCapToWebLyricSource({ state: s, getCurrentTimeSec });
        expect(web.state.track?.seed).toBe('Song · Artist');
        expect(web.state.track?.name).toBe('Song');
        expect(web.state.track?.artist).toBe('Artist');
        expect(web.state.clock).toBe(s.clock); // identical contract, no copy
        expect(web.state.playerState).toBe('playing');
        expect(web.state.connectionStatus).toBe('connected');
        expect(web.getCurrentTimeSec).toBe(getCurrentTimeSec); // stable identity for the shell rAF loop
    });

    it('coerces an empty cover to null and folds a non-connected status', () => {
        const web = playerCapToWebLyricSource({
            state: session({ connectionStatus: 'probing', track: { name: 'A', artist: 'B', coverUrl: '', title: 'A' } }),
            getCurrentTimeSec,
        });
        expect(web.state.track?.coverUrl).toBeNull();
        expect(web.state.connectionStatus).toBe('connecting');
    });

    it('passes a null track through', () => {
        const web = playerCapToWebLyricSource({ state: session({ track: null }), getCurrentTimeSec });
        expect(web.state.track).toBeNull();
    });
});
