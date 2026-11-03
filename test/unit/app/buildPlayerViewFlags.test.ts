import { describe, expect, it } from 'vitest';
import { buildPlayerViewFlags } from '@/components/app/presentation/buildPlayerViewFlags';

// test/unit/app/buildPlayerViewFlags.test.ts
// Whether the capsule's and the Lattice's play/pause can act on the current song. On the HiFi route
// audioSrc is always null (mpv plays the song), so the current HiFi track has to count too (finding #29).

type FlagInput = Parameters<typeof buildPlayerViewFlags>[0];

const input = (overrides: Partial<FlagInput> = {}): FlagInput => ({
    currentView: 'home',
    disableHomeDynamicBackground: false,
    hidePlayerProgressBar: false,
    hidePlayerTranslationSubtitle: false,
    hidePlayerRightPanelButton: false,
    isNowPlayingControlDisabled: false,
    activePlaybackContext: 'main',
    stageActiveEntryKind: null,
    audioSrc: null,
    duration: 0,
    playbackRoute: 'web',
    hasHifiTrack: false,
    ...overrides,
});

const canToggle = (overrides: Partial<FlagInput>) => buildPlayerViewFlags(input(overrides)).canToggleCurrentPlayback;

describe('canToggleCurrentPlayback', () => {
    it('is on for a web song with a source, and off with none', () => {
        expect(canToggle({ audioSrc: 'blob:song' })).toBe(true);
        expect(canToggle({ audioSrc: null })).toBe(false);
    });

    it('is on for the current HiFi track though audioSrc is null', () => {
        expect(canToggle({ playbackRoute: 'hifi', hasHifiTrack: true, audioSrc: null })).toBe(true);
    });

    it('is off on the HiFi route with no HiFi track, and for a leftover track once the route is web', () => {
        expect(canToggle({ playbackRoute: 'hifi', hasHifiTrack: false })).toBe(false);
        expect(canToggle({ playbackRoute: 'web', hasHifiTrack: true })).toBe(false);
    });

    it('stays off while a Now Playing stage owns the controls, HiFi or not', () => {
        expect(canToggle({ isNowPlayingControlDisabled: true, playbackRoute: 'hifi', hasHifiTrack: true })).toBe(false);
        expect(canToggle({ isNowPlayingControlDisabled: true, audioSrc: 'blob:song' })).toBe(false);
    });

    it('keeps the stage lyrics case', () => {
        expect(canToggle({ activePlaybackContext: 'stage', stageActiveEntryKind: 'lyrics', duration: 30 })).toBe(true);
        expect(canToggle({ activePlaybackContext: 'stage', stageActiveEntryKind: 'lyrics', duration: 0 })).toBe(false);
    });
});
