import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerState } from '@/types';
import { createFakeFadeGraph, type FakeFadeGraph } from '../services/fakeFadeGraph';

// test/unit/playback/usePlaybackTransportFade.test.ts
// pausePlayback / resumePlayback wired to the real fade controller: what the transport does with the
// element, the player state and the pending pause across quick toggles, track changes and blends.
// Keep refs scoped to each transport instance; lifecycle cleanup is covered by the mounted-hook tests.

vi.mock('react', () => ({
    useCallback: (callback: unknown) => callback,
    useRef: (value: unknown) => ({ current: value }),
    useEffect: () => {},
}));
vi.mock('react-i18next', async importOriginal => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({ t: (key: string) => key }),
}));

const storeMock = vi.hoisted(() => ({
    state: {
        activePlaybackContext: 'main',
        audioSrc: 'blob:song-a',
        duration: 180,
        currentSong: { id: 1, sourceRef: { kind: 'local', mediaId: 'a' } } as unknown,
    },
    setPlayerState: vi.fn(),
}));
vi.mock('@/stores/usePlaybackStore', () => ({
    usePlaybackStore: Object.assign(
        (selector: (state: typeof storeMock.state) => unknown) => selector(storeMock.state),
        { getState: () => storeMock.state },
    ),
    setPlayerState: storeMock.setPlayerState,
}));
vi.mock('@/stores/useStatusMessageStore', () => ({ setStatusMessage: vi.fn() }));
vi.mock('@/stores/motionSignals', () => ({ currentTime: { set: vi.fn(), get: () => 0 } }));

const { usePlaybackTransportController } = await import('@/components/app/playback/bridges/usePlaybackTransportController');
const {
    consumeProgrammaticPause,
    playbackFade,
    registerPlaybackFadeGraph,
    PAUSE_DRAIN_MS,
    PLAYBACK_FADE_SECONDS,
} = await import('@/services/playbackFade');

const D = PLAYBACK_FADE_SECONDS;
/** The paused element's drain, plus the short ramp back to unity after it. */
const DRAIN_AND_RESTORE = PAUSE_DRAIN_MS / 1000 + 0.05;

type FakeAudio = {
    paused: boolean;
    ended: boolean;
    currentSrc: string;
    currentTime: number;
    pause: ReturnType<typeof vi.fn>;
    play: ReturnType<typeof vi.fn>;
};

let graph: FakeFadeGraph;
let audio: FakeAudio;
let pauseDuringTransition: ReturnType<typeof vi.fn>;
let isTransitionAudible: ReturnType<typeof vi.fn>;
let syncOutputGain: ReturnType<typeof vi.fn>;

const advance = (seconds: number) => {
    // In 1ms steps, so a timer that schedules a ramp sees the audio clock at its own firing time.
    let remainingMs = Math.round(seconds * 1000);
    while (remainingMs > 0) {
        const stepMs = Math.min(1, remainingMs);
        graph.clock.now += stepMs / 1000;
        vi.advanceTimersByTime(stepMs);
        remainingMs -= stepMs;
    }
};

const buildTransport = () => usePlaybackTransportController({
    stageActiveEntryKind: null,
    isNowPlayingStageActive: false,
    audioRef: { current: audio as unknown as HTMLAudioElement },
    audioContextRef: { current: graph.context },
    stageLyricsClockRef: { current: { startTimeSec: 0, endTimeSec: 0, baseTimeSec: 0, startedAtMs: null } },
    setupAudioAnalyzer: vi.fn(),
    syncOutputGain: syncOutputGain as (targetVolume: number, smoothing?: number) => void,
    getTargetPlaybackVolume: () => 0.8,
    shouldRefreshCurrentOnlineAudioSource: () => false,
    recoverOnlinePlaybackSource: vi.fn(async () => ({ recovered: false as const })),
    getSyntheticStageLyricsTime: () => 0,
    syncStageLyricsClock: vi.fn(),
    pauseDuringTransition: pauseDuringTransition as () => boolean,
    isTransitionAudible: isTransitionAudible as () => boolean,
});

beforeEach(() => {
    vi.useFakeTimers();
    graph = createFakeFadeGraph();
    registerPlaybackFadeGraph(graph);
    playbackFade.cancel();
    audio = {
        paused: false,
        ended: false,
        currentSrc: 'blob:song-a',
        currentTime: 12,
        pause: vi.fn(() => { audio.paused = true; }),
        play: vi.fn(async () => { audio.paused = false; }),
    };
    pauseDuringTransition = vi.fn(() => false);
    isTransitionAudible = vi.fn(() => false);
    syncOutputGain = vi.fn();
    storeMock.setPlayerState.mockReset();
    storeMock.state.currentSong = { id: 1, sourceRef: { kind: 'local', mediaId: 'a' } };
});

afterEach(() => {
    // Let a pending post-pause drain fire, so the shared controller holds no dead timer handle.
    vi.runOnlyPendingTimers();
    playbackFade.cancel();
    registerPlaybackFadeGraph(null);
    vi.useRealTimers();
});

describe('pausePlayback', () => {
    it('reports PAUSED at once but only pauses the element after the fade', () => {
        const { pausePlayback } = buildTransport();
        pausePlayback();

        expect(storeMock.setPlayerState).toHaveBeenCalledWith(PlayerState.PAUSED);
        expect(audio.pause).not.toHaveBeenCalled();

        advance(D + 0.02);
        expect(audio.pause).toHaveBeenCalledTimes(1);
        advance(DRAIN_AND_RESTORE);
        expect(graph.param.value).toBe(1);
    });

    it('pauses straight away when the fade cannot run (no Web Audio graph)', () => {
        registerPlaybackFadeGraph(null);
        const { pausePlayback } = buildTransport();
        pausePlayback();

        expect(audio.pause).toHaveBeenCalledTimes(1);
        expect(storeMock.setPlayerState).toHaveBeenCalledWith(PlayerState.PAUSED);
    });

    it('pauses straight away when the element is not playing', () => {
        audio.paused = true;
        const { pausePlayback } = buildTransport();
        pausePlayback();

        expect(audio.pause).toHaveBeenCalledTimes(1);
        expect(playbackFade.isFadingOut()).toBe(false);
    });

    it('does not let a pause for the old song land on the song that replaced it', () => {
        const { pausePlayback } = buildTransport();
        pausePlayback();
        advance(D / 2);

        // Replaced by a path that did not go through playSong's cancel.
        storeMock.state.currentSong = { id: 2, sourceRef: { kind: 'local', mediaId: 'b' } };
        advance(D);

        expect(audio.pause).not.toHaveBeenCalled();
        // And the fade node is not left silent for the new song.
        advance(DRAIN_AND_RESTORE);
        expect(graph.param.value).toBe(1);
    });

    it('is dropped when the track change cancels the fade', () => {
        const { pausePlayback } = buildTransport();
        pausePlayback();
        advance(D / 2);

        playbackFade.cancel();
        advance(D * 2);

        expect(audio.pause).not.toHaveBeenCalled();
        expect(graph.param.value).toBe(1);
    });

    it('flush on a track change pauses the old song at once instead of leaving it audible', () => {
        const { pausePlayback } = buildTransport();
        pausePlayback();
        advance(D / 2);

        // playSong's entry, before the new song's source has loaded.
        playbackFade.flush();
        expect(audio.pause).toHaveBeenCalledTimes(1);
        advance(DRAIN_AND_RESTORE);
        expect(graph.param.value).toBe(1);

        // Its pause event is recognised as ours, once, so the new song's play intent survives it.
        expect(consumeProgrammaticPause(audio as unknown as HTMLMediaElement)).toBe(true);
        expect(consumeProgrammaticPause(audio as unknown as HTMLMediaElement)).toBe(false);

        advance(D * 3);
        expect(audio.pause).toHaveBeenCalledTimes(1);
    });

    it('flush during a blend marks the deck the blend cancel paused', () => {
        isTransitionAudible.mockReturnValue(true);
        pauseDuringTransition.mockReturnValue(true);
        const { pausePlayback } = buildTransport();
        pausePlayback();
        advance(D / 2);

        playbackFade.flush();
        expect(pauseDuringTransition).toHaveBeenCalledTimes(1);
        expect(consumeProgrammaticPause(audio as unknown as HTMLMediaElement)).toBe(true);
    });

    it('a pause that finishes on its own is not marked, so its event is handled as a listener pause', () => {
        const { pausePlayback } = buildTransport();
        pausePlayback();
        advance(D + 0.02);

        expect(audio.pause).toHaveBeenCalledTimes(1);
        expect(consumeProgrammaticPause(audio as unknown as HTMLMediaElement)).toBe(false);
    });

    it('keeps the pause when an armed blend moves currentSong to the incoming track mid-fade', () => {
        // Armed: the advance is in flight, the session is not idle, currentSong is still the old one.
        isTransitionAudible.mockReturnValue(true);
        pauseDuringTransition.mockReturnValue(true);
        const { pausePlayback } = buildTransport();
        pausePlayback();
        advance(D / 2);

        // playSong(isAutomixAdvance) resolves and the app commits to the incoming song.
        storeMock.state.currentSong = { id: 2, sourceRef: { kind: 'local', mediaId: 'b' } };
        advance(D);

        expect(pauseDuringTransition).toHaveBeenCalledTimes(1);
        advance(DRAIN_AND_RESTORE);
        expect(graph.param.value).toBe(1);
    });

    it('still keeps the pause if the blend was audible at the press but has gone idle by the end', () => {
        isTransitionAudible.mockReturnValueOnce(true).mockReturnValue(false);
        const { pausePlayback } = buildTransport();
        pausePlayback();
        advance(D / 2);
        storeMock.state.currentSong = { id: 2, sourceRef: { kind: 'local', mediaId: 'b' } };
        advance(D);

        // Ordinary pause of whatever deck is active, not a dropped one.
        expect(audio.pause).toHaveBeenCalledTimes(1);
    });

    it('defers the blend cancel to the end of the fade, so a mid-blend pause still lands on the right deck', () => {
        isTransitionAudible.mockReturnValue(true);
        pauseDuringTransition.mockReturnValue(true);
        const { pausePlayback } = buildTransport();
        pausePlayback();

        // The blend is left alone while the sound fades out ...
        expect(pauseDuringTransition).not.toHaveBeenCalled();
        advance(D + 0.02);
        // ... then cancelled onto the sounding deck; the arriving element is never touched.
        expect(pauseDuringTransition).toHaveBeenCalledTimes(1);
        expect(audio.pause).not.toHaveBeenCalled();
        expect(syncOutputGain).toHaveBeenCalledWith(0.8, 0);
        advance(DRAIN_AND_RESTORE);
        expect(graph.param.value).toBe(1);
    });

    it('fades even when the arriving deck is still silent mid-blend', () => {
        audio.paused = true;
        isTransitionAudible.mockReturnValue(true);
        pauseDuringTransition.mockReturnValue(true);
        const { pausePlayback } = buildTransport();
        pausePlayback();

        expect(playbackFade.isFadingOut()).toBe(true);
        advance(D + 0.02);
        expect(pauseDuringTransition).toHaveBeenCalledTimes(1);
    });
});

describe('resumePlayback', () => {
    it('cancels a pending pause instead of pressing play, with no step in the gain', async () => {
        const { pausePlayback, resumePlayback } = buildTransport();
        pausePlayback();
        advance(D * 0.6);
        const before = graph.param.value;

        await resumePlayback();

        expect(audio.play).not.toHaveBeenCalled();
        expect(storeMock.setPlayerState).toHaveBeenLastCalledWith(PlayerState.PLAYING);
        expect(graph.param.value).toBeCloseTo(before, 5);

        advance(D * 3);
        expect(audio.pause).not.toHaveBeenCalled();
        expect(graph.param.value).toBeCloseTo(1, 5);
    });

    it('starts a paused element silent, plays, then fades in', async () => {
        audio.paused = true;
        const { resumePlayback } = buildTransport();
        audio.play.mockImplementation(async () => {
            // Muted by the time the element starts: the first samples are not at full level.
            expect(graph.param.value).toBe(0);
            audio.paused = false;
        });

        await resumePlayback();
        expect(audio.play).toHaveBeenCalledTimes(1);
        expect(graph.param.value).toBe(0);

        advance(D / 2);
        expect(graph.param.value).toBeCloseTo(0.5, 5);
        advance(D);
        expect(graph.param.value).toBeCloseTo(1, 5);
        expect(storeMock.setPlayerState).toHaveBeenLastCalledWith(PlayerState.PLAYING);
    });

    it('does not dip an element that is already sounding', async () => {
        const { resumePlayback } = buildTransport();
        await resumePlayback();

        expect(graph.param.value).toBe(1);
        advance(D);
        expect(graph.param.value).toBe(1);
    });

    it('puts the volume back when play() is rejected', async () => {
        audio.paused = true;
        audio.play.mockRejectedValue(new DOMException('blocked', 'NotAllowedError'));
        const { resumePlayback } = buildTransport();

        await resumePlayback();

        expect(graph.param.value).toBe(1);
        expect(storeMock.setPlayerState).toHaveBeenLastCalledWith(PlayerState.PAUSED);
    });

    it('takes the normal path when the element was paused by hand during the pending fade', async () => {
        const { pausePlayback, resumePlayback } = buildTransport();
        pausePlayback();
        advance(D / 2);
        // The export controller pauses the element directly.
        audio.paused = true;

        await resumePlayback();
        expect(audio.play).toHaveBeenCalledTimes(1);

        // The pending pause was retired by starting playback, so it cannot land afterwards.
        advance(D * 3);
        expect(audio.pause).not.toHaveBeenCalled();
        expect(playbackFade.isFadingOut()).toBe(false);
    });
});

describe('quick toggles', () => {
    it('pause, resume, pause, resume leaves the audio playing at full level', async () => {
        const { pausePlayback, resumePlayback } = buildTransport();

        pausePlayback();
        advance(0.05);
        await resumePlayback();
        advance(0.04);
        pausePlayback();
        advance(0.05);
        await resumePlayback();
        advance(1);

        expect(audio.pause).not.toHaveBeenCalled();
        expect(audio.paused).toBe(false);
        expect(graph.param.value).toBeCloseTo(1, 5);
    });

    it('resume then pause right away fades back down and pauses once', async () => {
        audio.paused = true;
        const { pausePlayback, resumePlayback } = buildTransport();

        await resumePlayback();
        advance(D / 2);
        pausePlayback();
        advance(D + 0.05);

        expect(audio.pause).toHaveBeenCalledTimes(1);
        advance(DRAIN_AND_RESTORE);
        expect(graph.param.value).toBe(1);
    });
});
