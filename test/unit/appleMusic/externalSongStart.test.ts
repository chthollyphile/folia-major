// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import { currentTime } from '@/stores/motionSignals';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { seekExternalSongIfNotLoaded, startExternalSong } from '@/components/app/playback/start/externalSongStart';

// test/unit/appleMusic/externalSongStart.test.ts
// The play button and a seek on a restored external song: it starts where the screen shows it, or
// over again from the start when it was left at its end.

const song: SongResult = {
    id: 'apple-song',
    name: 'Song',
    artists: [],
    album: { id: '', name: '' },
    durationMs: 200000,
    sourceRef: { kind: 'online', providerId: 'appleMusic', mediaId: 'apple-song' },
};

const playSong = () => vi.fn(async () => {});

describe('starting an external song outside the main play path', () => {
    afterEach(() => {
        usePlaybackStore.setState({ currentSong: null, playQueue: [], isFmMode: false, duration: 0, playbackRoute: 'web' });
        currentTime.set(0);
    });

    it('starts at the position shown, and over from the start at the end', () => {
        usePlaybackStore.setState({ currentSong: song, playQueue: [song], isFmMode: false, duration: 200 });
        const play = playSong();
        currentTime.set(42);
        startExternalSong(play);
        expect(play).toHaveBeenCalledWith(song, [song], false, { shouldNavigateToPlayer: false, startAtSec: 42 });

        play.mockClear();
        currentTime.set(200);
        startExternalSong(play);
        expect(play).toHaveBeenCalledWith(song, [song], false, { shouldNavigateToPlayer: false, startAtSec: 0 });
    });

    it('starts a seeked external song whose player has nothing loaded, and only then', () => {
        usePlaybackStore.setState({ currentSong: song, playQueue: [song], isFmMode: false, duration: 200, playbackRoute: 'web' });
        const play = playSong();
        expect(seekExternalSongIfNotLoaded(30, play)).toBe(true);
        expect(play).toHaveBeenCalledWith(song, [song], false, { shouldNavigateToPlayer: false, startAtSec: 30 });

        play.mockClear();
        usePlaybackStore.setState({ playbackRoute: 'external' });
        expect(seekExternalSongIfNotLoaded(30, play)).toBe(false);
        expect(play).not.toHaveBeenCalled();
    });
});
