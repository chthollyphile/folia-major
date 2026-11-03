import { beforeEach, describe, expect, it } from 'vitest';
import { PlayerState } from '@/types';
import { endLoadingToPlay, selectDisplayPlayerState, setPlayerState, startLoadingToPlay, usePlaybackStore } from '@/stores/usePlaybackStore';

// test/unit/playback/loadingToPlayDisplay.test.ts
// Every song change passes through IDLE while the next song loads to play on. The shown state counts
// that as playing; anything that really stops (a pause, a stop, a failed source) shows at once.

const shown = () => selectDisplayPlayerState(usePlaybackStore.getState());

beforeEach(() => {
    setPlayerState(PlayerState.PLAYING);
});

describe('the shown state while a song loads to play', () => {
    it('is playing while the next song loads, and the raw state is IDLE', () => {
        startLoadingToPlay();
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.IDLE);
        expect(shown()).toBe(PlayerState.PLAYING);
        setPlayerState(PlayerState.PLAYING);
        expect(shown()).toBe(PlayerState.PLAYING);
    });

    it('stops at once for a pause, a stop or a failed source', () => {
        startLoadingToPlay();
        setPlayerState(PlayerState.PAUSED);
        expect(shown()).toBe(PlayerState.PAUSED);

        startLoadingToPlay();
        setPlayerState(PlayerState.IDLE);
        expect(shown()).toBe(PlayerState.IDLE);

        startLoadingToPlay();
        endLoadingToPlay();
        expect(shown()).toBe(PlayerState.IDLE);
    });
});
