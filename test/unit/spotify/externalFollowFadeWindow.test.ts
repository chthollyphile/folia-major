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
const { usePlaybackStore, setPlayerState } = await import('@/stores/usePlaybackStore');
const { PlayerState } = await import('@/types');
const { useAudioSettingsStore } = await import('@/stores/useAudioSettingsStore');
const { consumeProgrammaticPause, playbackFade, registerPlaybackFadeGraph, PAUSE_DRAIN_MS, PLAYBACK_FADE_SECONDS } = await import('@/services/playbackFade');
const { PLAYBACK_DECK_ATTRIBUTE } = await import('@/components/hifi/useWebEngineYield');
const { isHifiRoute } = await import('@/services/hifi/hifiRouteGuard');

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
    /** App.tsx's `shouldAutoPlay`: the intent to play, which a pause read as the listener's spends. */
    const shouldAutoPlay = { current: true };

    beforeEach(() => {
        vi.useFakeTimers();
        // The intent starts unspent. It is true rather than the app's own false, so a handler that
        // never touched it still reads as unspent, and an assertion can tell a spent intent from an
        // untouched one.
        shouldAutoPlay.current = true;
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
        // Its pause event is this app's own: read as the listener's, it would pause the taken song.
        expect(consumeProgrammaticPause(deck.element)).toBe(true);
    });

    // The mark itself: one event is recognised, and the listener's next one is theirs again.
    it('recognises the emptied deck\'s pause once, and no more', async () => {
        const onSettled = vi.fn();
        const { following, deck } = await readAfterThePress(onSettled);

        await expect(following).resolves.toBe('adopted');
        expect(consumeProgrammaticPause(deck.element)).toBe(true);
        expect(consumeProgrammaticPause(deck.element)).toBe(false);
    });

    // The pause event the emptied deck fires arrives after the take-over put another song on screen.
    // Read as the listener's own it drops the transport to PAUSED over a player that is sounding, so
    // the mark has to be consumed by it - once, and no more: a mark left standing would swallow the
    // listener's next real pause.
    //
    // The handler below is App.tsx's onPause (the audio element's), guard for guard and in its own
    // order, with what the test stands in for named at each line. Only two things are stood in for,
    // both of them values App.tsx holds in its own render: `isActiveDeck` is
    // `element === audioRef.current` there, so the deck the test made IS the active deck and any
    // other element is not; and the autoplay intent is a plain object with a `current` rather than
    // App's ref. The route guard, the fade's mark and the transport are the app's own modules.
    const pauseHandler = (element: HTMLAudioElement | null) => {
        // App.tsx: the four early-outs, then the intent, then the transport state.
        return (event: { currentTarget: HTMLAudioElement }) => {
            // A pause that flushing a fade-out made, while a new song is already being set up.
            if (consumeProgrammaticPause(event.currentTarget)) return;
            // The Web engine yielding to mpv pauses the deck: the HiFi song's intent stays.
            if (isHifiRoute()) return;
            // App.tsx asks its automix session; here the deck under test is the active one.
            if (event.currentTarget !== element) return;
            // A deck whose source failed fires pause right after error; that is the error path's.
            if (event.currentTarget.error) return;
            shouldAutoPlay.current = false;
            if (!event.currentTarget.ended) {
                setPlayerState(PlayerState.PAUSED);
            }
        };
    };

    it('does not let that deck\'s pause event pause the song the player sounds', async () => {
        const onSettled = vi.fn();
        const { following, deck } = await readAfterThePress(onSettled);
        const onPause = pauseHandler(deck.element);

        await expect(following).resolves.toBe('adopted');
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);

        // The event the emptied deck fires for the pause of the take-over.
        onPause({ currentTarget: deck.element });
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
        // Nothing of the listener's intent was spent by an event that was not theirs.
        expect(shouldAutoPlay.current).toBe(true);
        // The mark is spent with that one event: the listener's own next pause is theirs again.
        expect(consumeProgrammaticPause(deck.element)).toBe(false);
        onPause({ currentTarget: deck.element });
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);
        expect(shouldAutoPlay.current).toBe(false);
    });

    // The same handler with the mark taken away: the very same event is read as the listener's, which
    // is what the mark exists to prevent. Without this the test above cannot tell a handler that
    // dropped the event apart from one that never looked at the mark at all.
    it('pauses the transport on that same event once the mark is not there', async () => {
        const onSettled = vi.fn();
        const { following, deck } = await readAfterThePress(onSettled);
        const onPause = pauseHandler(deck.element);

        await expect(following).resolves.toBe('adopted');
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);

        // The mark the deck was emptied under is spent before its event arrives.
        expect(consumeProgrammaticPause(deck.element)).toBe(true);
        onPause({ currentTarget: deck.element });
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);
    });

    it('drops the pause the fade-out was still going to make', async () => {
        const onSettled = vi.fn();
        const { following } = await readAfterThePress(onSettled);

        await expect(following).resolves.toBe('adopted');
        await vi.advanceTimersByTimeAsync(PLAYBACK_FADE_SECONDS * 1000 + PAUSE_DRAIN_MS + 100);
        expect(onSettled).not.toHaveBeenCalled();
    });
});
