import { describe, expect, it, vi } from 'vitest';
import { buildAppOverlaysModel } from '../../../src/components/app/overlays/buildAppOverlaysModel';
import { shouldShowNowPlayingToast } from '../../../src/components/app/overlays/now-playing-toast/nowPlayingToastVisibility';
import { wallPageKey } from '../../../src/components/app/lattice/wallLocate';
import { useAppViewStore } from '../../../src/stores/useAppViewStore';
import { usePlaybackStore } from '../../../src/stores/usePlaybackStore';
import { usePlayingSongLocatorStore } from '../../../src/stores/usePlayingSongLocatorStore';
import { PlayerState, type SongResult } from '../../../src/types';
import { getPlaybackSongKey } from '../../../src/utils/appPlaybackGuards';

// test/unit/stage/nowPlayingToastVisibility.test.ts

describe('now playing toast visibility', () => {
    it.each(['player', 'lattice'] as const)('shows on %s without the home opt-in', view => {
        expect(shouldShowNowPlayingToast({ mode: 'auto', view, showOnHome: false })).toBe(true);
    });

    it('shows on a wall library home (bravais) without the opt-in, like Lattice; never still wins', () => {
        expect(shouldShowNowPlayingToast({ mode: 'auto', view: 'home', showOnHome: false, homeIsWall: true })).toBe(true);
        expect(shouldShowNowPlayingToast({ mode: 'never', view: 'home', showOnHome: true, homeIsWall: true })).toBe(false);
    });

    it('keeps home opt-in and never mode semantics', () => {
        expect(shouldShowNowPlayingToast({ mode: 'auto', view: 'home', showOnHome: false })).toBe(false);
        expect(shouldShowNowPlayingToast({ mode: 'always', view: 'home', showOnHome: true })).toBe(true);
        expect(shouldShowNowPlayingToast({ mode: 'never', view: 'lattice', showOnHome: true })).toBe(false);
    });

    it('routes a Lattice card click to the locate of the wall', () => {
        const song: SongResult = {
            id: 'now',
            name: 'Now',
            artists: [{ id: 1, name: 'Artist' }],
            album: { id: 1, name: 'Album' },
            durationMs: 180000,
            sourceRef: { kind: 'online', providerId: 'netease', mediaId: 'now' },
        };
        // The locator asks about the song the player has, on the wall that is up.
        usePlaybackStore.setState({ currentSong: song, playQueue: [song] });
        useAppViewStore.setState({ view: 'lattice', latticeSource: 'queue' });
        const navigateToPlayer = vi.fn();
        const openSongCardPanel = vi.fn();
        const model = buildAppOverlaysModel({
            currentView: 'lattice',
            stageTrackPillOnScreen: true,
            currentSong: song,
            playerState: PlayerState.PLAYING,
            playQueue: [song],
            effectiveLoopMode: 'off',
            isFmMode: false,
            isNowPlayingStageActive: false,
            isNowPlayingControlDisabled: false,
            stageTrackPillMode: 'always',
            stageTrackPillTimeoutSec: 10,
            stageNextUp: null,
            stageIsNextUp: false,
            coverUrl: null,
            isDaylight: false,
            navigateToPlayer,
            openSongCardPanel,
            stageTrackPillOpenPlayerLabel: 'Open player',
            stageTrackPillOpenSongCardLabel: 'Open song card',
            stageTrackPillFocusLatticeLabel: 'Locate the playing song on this page',
        } as unknown as Parameters<typeof buildAppOverlaysModel>[0]);

        expect(model.nowPlayingToast?.activateLabel).toBe('Locate the playing song on this page');
        model.nowPlayingToast?.onActivate?.();
        expect(usePlayingSongLocatorStore.getState().request).toMatchObject({
            collectionKey: wallPageKey('queue'), songKey: getPlaybackSongKey(song), waits: false,
        });
        expect(navigateToPlayer).not.toHaveBeenCalled();
        expect(openSongCardPanel).not.toHaveBeenCalled();
        usePlayingSongLocatorStore.getState().setRequest(null);
        usePlaybackStore.setState({ currentSong: null, playQueue: [] });
        useAppViewStore.setState({ view: 'home' });
    });
});
