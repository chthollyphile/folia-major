import { beforeEach, describe, expect, it } from 'vitest';
import type { UnifiedSong } from '@/types';
import { PlayerState } from '@/types';
import { selectDisplaySong, usePlaybackStore } from '@/stores/usePlaybackStore';
import { noteAcceptedFmPlayback, replacePlayQueue } from '@/services/playbackQueueOrigin';
import { getPlaybackSongKey } from '@/utils/appPlaybackGuards';
import { usePlayingSongLocatorStore } from '@/stores/usePlayingSongLocatorStore';

// A pending play changes the requested FM mode before its song lands; only accepted playback owns the queue.

const selection = { mode: 'DEFAULT' as const, scene: null };
const song = (id: string): UnifiedSong => ({
    id, name: id, artists: [], album: { id: 'album', name: 'Album' }, durationMs: 120000,
    sourceRef: { kind: 'online', providerId: 'probe', mediaId: id },
});
const ordinary = song('ordinary');
const first = song('first-fm');
const next = song('next-fm');
const accepted = () => usePlaybackStore.getState().acceptedFmPlayback;
const land = (current: UnifiedSong, queue: UnifiedSong[], isFmMode: boolean) => {
    usePlaybackStore.setState({ currentSong: current, playQueue: queue, isFmMode });
    noteAcceptedFmPlayback(current, queue, isFmMode, selection);
};

beforeEach(() => {
    usePlaybackStore.setState({ currentSong: null, playQueue: [], isFmMode: false, acceptedFmPlayback: null, transitionDisplay: null });
    usePlayingSongLocatorStore.getState().setSource(null);
});

describe('accepted FM playback provenance', () => {
    it('does not claim the ordinary song while a new FM request still waits for audio', () => {
        land(ordinary, [ordinary], false);
        usePlaybackStore.getState().setIsFmMode(true);
        expect(usePlaybackStore.getState().isFmMode).toBe(true);
        expect(accepted()).toBeNull();
        // A refused or overtaken request changes no accepted provenance.
        usePlaybackStore.getState().setIsFmMode(false);
        expect(accepted()).toBeNull();
    });

    it('starts following FM only after its own song and queue land', () => {
        land(ordinary, [ordinary], false);
        usePlaybackStore.getState().setIsFmMode(true);
        expect(accepted()).toBeNull();
        land(first, [first, next], true);
        expect(accepted()?.songKeys.has(getPlaybackSongKey(first))).toBe(true);
        expect(usePlaybackStore.getState().acceptedFmPlayback?.songKeys).toEqual(new Set([first, next].map(getPlaybackSongKey)));
        land(next, [first, next], true);
        usePlaybackStore.getState().setPlayerState(PlayerState.PAUSED);
        expect(accepted()?.songKeys.has(getPlaybackSongKey(next))).toBe(true);
    });

    it('keeps the accepted FM song while another requested mode has not landed, then clears on an ordinary landing', () => {
        land(first, [first, next], true);
        usePlaybackStore.getState().setIsFmMode(false);
        expect(accepted()?.songKeys.has(getPlaybackSongKey(first))).toBe(true);
        land(ordinary, [ordinary], false);
        expect(accepted()).toBeNull();
        expect(usePlaybackStore.getState().acceptedFmPlayback).toBeNull();
    });

    it('uses the mode captured by the accepted play, even if a newer mode is requested elsewhere', () => {
        land(first, [first, next], true);
        const captured = { mode: 'SCENE_RCMD' as const, scene: 'rain' };
        noteAcceptedFmPlayback(first, [first, next], true, captured);
        expect(usePlaybackStore.getState().acceptedFmPlayback?.selection).toBe(captured);
        expect(accepted()?.songKeys).toEqual(new Set([first, next].map(getPlaybackSongKey)));
    });

    it('clears ownership atomically when an extension replaces the queue, and rebuilds it on an FM undo', () => {
        land(first, [first, next], true);
        replacePlayQueue([first, next], false);
        expect(accepted()).toBeNull();
        expect(usePlaybackStore.getState().acceptedFmPlayback).toBeNull();
        replacePlayQueue([first, next], true);
        expect(accepted()?.songKeys.has(getPlaybackSongKey(first))).toBe(true);
    });

    it('does not associate an unrelated outgoing automix tail with a newly accepted FM queue', () => {
        land(first, [first], true);
        usePlaybackStore.getState().setTransitionDisplay({ song: ordinary, lyrics: null, coverUrl: null, duration: 120 });
        expect(selectDisplaySong(usePlaybackStore.getState())).toBe(ordinary);
        expect(accepted()?.songKeys.has(getPlaybackSongKey(ordinary))).toBe(false);
        usePlaybackStore.getState().releaseTransitionDisplay('handedOver');
        expect(accepted()?.songKeys.has(getPlaybackSongKey(first))).toBe(true);
    });

    it('rejects a purported accepted FM song absent from its queue and clears an empty restore', () => {
        land(first, [first], true);
        noteAcceptedFmPlayback(ordinary, [first], true, selection);
        expect(usePlaybackStore.getState().acceptedFmPlayback).toBeNull();
        noteAcceptedFmPlayback(null, [], false);
        expect(accepted()).toBeNull();
    });

    it('forgets a Daily origin on replacement and does not infer it from an undo of overlapping songs', () => {
        land(first, [first, next], false);
        const collection = { source: 'online' as const, providerId: 'probe', id: 'daily', type: 'daily_recommendations', name: 'Daily 30' };
        usePlayingSongLocatorStore.getState().setSource({ collection, songKeys: new Set([first, next].map(getPlaybackSongKey)) });
        expect(usePlayingSongLocatorStore.getState().source?.collection).toBe(collection);
        replacePlayQueue([next, first], false);
        expect(usePlayingSongLocatorStore.getState().source).toBeNull();
        replacePlayQueue([first, next], false);
        expect(usePlayingSongLocatorStore.getState().source).toBeNull();
        // A later explicit collection play establishes a new, trustworthy origin.
        usePlayingSongLocatorStore.getState().setSource({ collection, songKeys: new Set([first, next].map(getPlaybackSongKey)) });
        expect(usePlayingSongLocatorStore.getState().source?.collection).toBe(collection);
    });
});
