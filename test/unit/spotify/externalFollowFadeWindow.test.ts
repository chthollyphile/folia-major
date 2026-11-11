// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import type { ProviderExternalPlaybackStatus } from '@/types/onlineMusic';

// test/unit/spotify/externalFollowFadeWindow.test.ts
// A local song sounding in this window while the listener presses pause: the screen reads PAUSED
// at once, the deck keeps sounding until the fade-out ends (~200ms), and the pause itself is
// dropped when another song is on screen by then. A read of the player that began before that press
// lands in the middle of it, takes the player over and puts another song on screen - so the deck has
// to be stopped here, and the pending pause dropped, or the local song sounds on beside the player.

const traits = vi.hoisted(() => ({
    declared: {
        capturesSystemAudio: true,
        startsWithoutWaiting: true,
        backsOffStatusPolls: true,
        holdsMediaKeysWhilePlaying: true,
        followsPlayerChanges: true,
    } as Record<string, boolean>,
}));

const omniMock = vi.hoisted(() => ({
    canPlayExternally: vi.fn<(song: SongResult) => boolean>(() => true),
    canPlaySong: vi.fn(() => true),
    prepareExternalPlaybackQueue: vi.fn(async () => {}),
    playSongExternally: vi.fn(async () => {}),
    pauseExternalPlayback: vi.fn(async () => {}),
    resumeExternalPlayback: vi.fn(async () => {}),
    seekExternalPlayback: vi.fn(async () => {}),
    setExternalPlaybackVolume: vi.fn(async () => {}),
    getExternalPlaybackStatus: vi.fn(async (): Promise<ProviderExternalPlaybackStatus> => ({
        mediaId: '456', isPlaying: true, positionMs: 10000, durationMs: 200000, ended: false,
    })),
    getExternalPlaybackRunningStatus: vi.fn(async (): Promise<ProviderExternalPlaybackStatus | null> => null),
    getExternalPlaybackRunningPositionMs: vi.fn(async (): Promise<number | null> => null),
    isExternalPlaybackStatusForSong: vi.fn((song: SongResult, status: ProviderExternalPlaybackStatus) => (
        status.mediaId === (song.sourceRef?.kind === 'online' ? song.sourceRef.mediaId : '')
    )),
    getSongDetail: vi.fn(async (): Promise<SongResult | null> => null),
    adoptExternalPlayback: vi.fn(() => {}),
    externalPlaybackTraits: vi.fn(() => traits.declared),
    followsPlayerChangesOf: vi.fn(() => traits.declared.followsPlayerChanges === true),
    followingPlayerChangesProviderId: vi.fn((): string | null => (traits.declared.followsPlayerChanges === true ? 'spotify' : null)),
    getExternalPlaybackRunningTrack: vi.fn(async (): Promise<ProviderExternalPlaybackStatus | null> => null),
}));

vi.mock('@/services/onlineMusic/omni', () => ({ omni: omniMock }));

const engine = await import('@/services/onlineMusic/externalPlayback');
const { followRunningExternalPlayer, followsPlayerChangesForShownSong } = await import('@/components/app/playback/bridges/externalPlayerFollow');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { PlayerState } = await import('@/types');
const { useAudioSettingsStore } = await import('@/stores/useAudioSettingsStore');
const { playbackFade, registerPlaybackFadeGraph, PAUSE_DRAIN_MS, PLAYBACK_FADE_SECONDS } = await import('@/services/playbackFade');
const { PLAYBACK_DECK_ATTRIBUTE } = await import('@/components/hifi/useWebEngineYield');

const songOn = (mediaId: string, name = mediaId): SongResult => ({
    id: mediaId,
    name,
    artists: [{ id: '', name: 'Artist' }],
    album: { id: '', name: 'Album' },
    durationMs: 200000,
    sourceRef: { kind: 'online', providerId: 'spotify', mediaId },
});

/** A song of the listener's own library: it plays on a deck here, never in the external player. */
const localSong: SongResult = {
    ...songOn('local-1', 'Local'),
    id: 'local-1',
    isLocal: true,
    localRef: { songId: 'local-1' },
    sourceRef: { kind: 'local', mediaId: 'local-1' },
} as SongResult;

const track = songOn('456', 'Another');

const status = (overrides: Partial<ProviderExternalPlaybackStatus> = {}): ProviderExternalPlaybackStatus => ({
    mediaId: '456', isPlaying: true, positionMs: 10000, durationMs: 200000, ended: false, ...overrides,
});

/** A deck here: jsdom plays nothing, so its play state is set by hand and pause and load are recorded. */
const deckElement = (deck: string) => {
    const element = document.createElement('audio');
    element.setAttribute(PLAYBACK_DECK_ATTRIBUTE, deck);
    element.setAttribute('src', `blob:deck-${deck}`);
    let paused = true;
    Object.defineProperty(element, 'paused', { configurable: true, get: () => paused });
    element.pause = vi.fn(() => { paused = true; });
    element.load = vi.fn(() => {});
    document.body.appendChild(element);
    return { element, startSounding: () => { paused = false; } };
};

/** The fade node of the Web Audio graph, which the transport ramps down before it pauses the deck. */
const fakeGraph = () => {
    const param = {
        value: 1,
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        cancelAndHoldAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
    };
    const context = { state: 'running' } as unknown as AudioContext;
    return { context, gain: { gain: param } as unknown as GainNode };
};

describe('a local song still sounding while its pause fades out', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        engine.installExternalPlayback();
        engine.stopExternalPlayback('test reset');
        traits.declared = {
            capturesSystemAudio: true,
            startsWithoutWaiting: true,
            backsOffStatusPolls: true,
            holdsMediaKeysWhilePlaying: true,
            followsPlayerChanges: true,
        };
        omniMock.canPlayExternally.mockReset().mockReturnValue(true);
        omniMock.getExternalPlaybackStatus.mockReset().mockResolvedValue(status());
        omniMock.getExternalPlaybackRunningTrack.mockReset().mockResolvedValue(status({ mediaId: '456' }));
        omniMock.getSongDetail.mockReset().mockResolvedValue(track);
        omniMock.prepareExternalPlaybackQueue.mockReset().mockResolvedValue(undefined);
        omniMock.playSongExternally.mockReset().mockResolvedValue(undefined);
        omniMock.pauseExternalPlayback.mockReset().mockResolvedValue(undefined);
        omniMock.setExternalPlaybackVolume.mockReset().mockResolvedValue(undefined);
        useAudioSettingsStore.setState({ volume: 1, isMuted: false, playbackFadeEnabled: true });
        // The screen reads PAUSED from the press of pause on; the song on screen is not one the
        // external player could ever sound.
        usePlaybackStore.setState({
            playbackRoute: 'web', audioSrc: 'blob:deck-A', playerState: PlayerState.PAUSED,
            currentSong: localSong, playQueue: [localSong], isFmMode: false,
        });
    });

    afterEach(() => {
        engine.stopExternalPlayback('test end');
        playbackFade.cancel();
        registerPlaybackFadeGraph(null);
        document.body.innerHTML = '';
        usePlaybackStore.setState({ playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE, playQueue: [] });
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('does not read the player while a deck here still sounds', async () => {
        const deck = deckElement('A');
        deck.startSounding();

        await expect(followRunningExternalPlayer()).resolves.toBe('untouched');
        expect(followsPlayerChangesForShownSong()).toBe(false);
        expect(omniMock.getExternalPlaybackRunningTrack).not.toHaveBeenCalled();
        expect(engine.getExternalSong()).toBeNull();
        expect(usePlaybackStore.getState().currentSong).toEqual(localSong);
    });

    it('leaves a deck that is paused here alone', async () => {
        deckElement('A');

        // Silence is the pause: the read goes as it does with no deck at all.
        await expect(followRunningExternalPlayer()).resolves.toBe('adopted');
        expect(engine.getExternalSong()).toEqual(track);
    });

    // The read began while this window was silent; the listener pressed pause while it was on its
    // way, so the deck was still ramping down when the take-over landed.
    const readAfterThePress = async (onSettled: () => void) => {
        registerPlaybackFadeGraph(fakeGraph());
        const deck = deckElement('A');
        let answer!: (value: ProviderExternalPlaybackStatus) => void;
        omniMock.getExternalPlaybackRunningTrack.mockImplementation(() => new Promise<ProviderExternalPlaybackStatus>(done => {
            answer = done;
        }));
        const following = followRunningExternalPlayer();
        await vi.advanceTimersByTimeAsync(0);
        // The press: the screen is PAUSED, the fade-out is running and the deck sounds until it ends.
        deck.startSounding();
        usePlaybackStore.setState({ playerState: PlayerState.PAUSED });
        expect(playbackFade.fadeOutThen(onSettled)).toBe(true);
        answer(status({ mediaId: '456' }));
        return { following, deck, settle: onSettled };
    };

    it('stops the deck once the player was taken over', async () => {
        const onSettled = vi.fn();
        const { following, deck } = await readAfterThePress(onSettled);

        await expect(following).resolves.toBe('adopted');
        expect(engine.getExternalSong()).toEqual(track);
        expect(deck.element.pause).toHaveBeenCalled();
        expect(deck.element.hasAttribute('src')).toBe(false);
    });

    it('drops the pause the fade-out was still going to make', async () => {
        const onSettled = vi.fn();
        const { following } = await readAfterThePress(onSettled);

        await expect(following).resolves.toBe('adopted');
        await vi.advanceTimersByTimeAsync(PLAYBACK_FADE_SECONDS * 1000 + PAUSE_DRAIN_MS + 100);
        expect(onSettled).not.toHaveBeenCalled();
    });
});
