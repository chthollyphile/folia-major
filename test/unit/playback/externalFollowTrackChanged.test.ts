// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/playback/externalFollowTrackChanged.test.ts
// What the bridge does when the route reports that the player moved on to a track Folia did not ask
// for: that track is taken over in place of the song on screen, and the player is only stopped where
// nothing was taken. A track taken over is either the player's now (adopted) or shown paused where
// it is (shown): both are on screen, so neither is stopped - f25db71e5 is the commit that fixed a
// pause being stopped here. A take-over that took nothing and one that threw leave the player
// sounding a track the listener picked in its own window, and that one is never stopped either: the
// player is left as it is, and the most this app does with the track is leave it sounding.

/** What a take-over is handed by its caller: the hooks it answers once it holds the track. */
type TakeOverOptions = { onTrackTaken?: (track: unknown, stillCurrent: () => boolean) => Promise<void> | void };

const env = vi.hoisted(() => ({
    effects: [] as Array<{ run: () => unknown; cleanup?: () => void }>,
    listener: null as null | ((event: unknown) => void),
    traits: { followsPlayerChanges: true } as Record<string, boolean>,
    externalRoute: true,
    externalSong: { id: 'song' } as unknown,
    outcome: 'adopted' as string,
    adopt: vi.fn<(shown: unknown, status: unknown, options?: TakeOverOptions) => Promise<string>>(async () => 'adopted'),
    stopForeign: vi.fn<(reason?: string) => void>(),
    /** What the bridge wrote for the track it took over: its cover and its lyrics. */
    coverDropped: vi.fn<(url: unknown) => void>(),
    lyricsSet: vi.fn<(lyrics: unknown) => void>(),
    lyricsLoading: [] as boolean[],
    detailsLoaded: vi.fn<(track: unknown, stillCurrent: () => boolean, applyLyrics: (lyrics: unknown) => void) => Promise<void>>(
        async () => undefined,
    ),
    status: { mediaId: 'other', isPlaying: true, positionMs: 1000, durationMs: 2000, ended: false },
}));

vi.mock('react', () => ({
    useCallback: (callback: unknown) => callback,
    useMemo: (factory: () => unknown) => factory(),
    useRef: (current: unknown) => ({ current }),
    useState: (value: unknown) => [value, vi.fn()],
    useEffect: (effect: () => unknown) => { env.effects.push({ run: effect }); },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/services/onlineMusic/externalPlayback', () => ({
    installExternalPlayback: () => {},
    subscribeExternalPlayback: (listener: (event: unknown) => void) => {
        env.listener = listener;
        return () => { env.listener = null; };
    },
    isExternalRoute: () => env.externalRoute,
    getExternalSong: () => env.externalSong,
    isExternalTakeoverPending: () => false,
    stopForeignExternalPlayback: () => env.stopForeign(),
}));
vi.mock('@/components/app/playback/externalSpectrumCapture', () => ({
    stopExternalSpectrumCapture: () => {},
    syncExternalSpectrumForRoute: () => {},
}));
vi.mock('@/services/onlineMusic/omni', () => ({
    omni: {
        warmUpExternalPlayers: vi.fn(async () => undefined),
        externalPlaybackTraits: () => env.traits,
    },
}));
vi.mock('@/components/app/playback/externalPlayerWake', () => ({ runExternalPlayerWarmUp: vi.fn(async () => undefined) }));
vi.mock('@/stores/useDesktopSettingsStore', () => {
    const read = () => ({ wakeExternalPlayersOnLaunch: false, externalSystemAudioSpectrum: false });
    const store = (selector?: (state: unknown) => unknown) => (selector ? selector(read()) : read());
    return { useDesktopSettingsStore: Object.assign(store, { getState: read, subscribe: () => () => {} }) };
});
vi.mock('@/stores/useAudioSettingsStore', () => {
    const read = () => ({ loopMode: 'all', isMuted: false, volume: 1 });
    const store = (selector?: (state: unknown) => unknown) => (selector ? selector(read()) : read());
    return { useAudioSettingsStore: Object.assign(store, { getState: read, subscribe: () => () => {} }) };
});
vi.mock('@/stores/useStatusMessageStore', () => ({ setStatusMessage: () => undefined }));
vi.mock('@/stores/usePlaybackStore', () => {
    const state = {
        currentSong: { id: 'song' } as unknown, playbackRoute: 'external', playQueue: [] as unknown[],
        setPlayQueue: (next: unknown) => {
            state.playQueue = (typeof next === 'function' ? (next as (previous: unknown[]) => unknown[])(state.playQueue) : next) as unknown[];
        },
        setCachedCoverUrl: (next: unknown) => env.coverDropped(next),
        setLyricsState: (next: unknown) => env.lyricsSet(next),
    };
    const read = () => state;
    const store = (selector?: (state: unknown) => unknown) => (selector ? selector(read()) : read());
    return {
        usePlaybackStore: Object.assign(store, { getState: read, subscribe: () => () => {} }),
        setCachedCoverUrl: (next: unknown) => state.setCachedCoverUrl(next),
        setLyricsState: (next: unknown) => state.setLyricsState(next),
    };
});
// What the take-over writes for the track it took over, reached through a dynamic import: its own
// cover and lyrics, and the queue the track goes in.
vi.mock('@/components/app/playback/restore/runningTrack', () => ({
    loadTakenTrackDetails: (
        track: unknown, stillCurrent: () => boolean, applyLyrics: (lyrics: unknown) => void,
    ) => env.detailsLoaded(track, stillCurrent, applyLyrics),
    queueWithRunningTrack: (queue: unknown[], track: unknown) => [...queue, track],
}));
vi.mock('@/components/app/playback/bridges/externalPlayerFollow', () => ({
    followsPlayerChangesForShownSong: () => env.traits.followsPlayerChanges === true,
    followRunningExternalPlayer: async () => 'untouched',
    takeOverRunningPlayer: (shown: unknown, status: unknown, options?: TakeOverOptions) => env.adopt(shown, status, options),
}));

const { useExternalPlaybackBridge } = await import('@/components/app/playback/bridges/useExternalPlaybackBridge');

/** Mounts the bridge and hands back the listener the route reports through. */
const MountBridge = () => {
    env.effects.length = 0;
    env.listener = null;
    useExternalPlaybackBridge({
        handleNextTrack: vi.fn(), handlePrevTrack: vi.fn(),
        setShownLyrics: (lyrics: unknown) => env.lyricsSet(lyrics),
        setIsLyricsLoading: (loading: boolean) => env.lyricsLoading.push(loading),
    });
    for (const effect of env.effects) effect.cleanup = effect.run() as (() => void) | undefined;
    expect(env.listener).not.toBeNull();
    return (event: unknown) => env.listener!(event);
};

describe('the track the player moved on to', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        env.traits = { followsPlayerChanges: true };
        env.externalRoute = true;
        env.externalSong = { id: 'song' };
        env.outcome = 'adopted';
        env.adopt.mockReset();
        env.detailsLoaded.mockReset().mockResolvedValue(undefined);
        // The take-over answers its caller's own hook once it holds the track, as the real one does.
        env.adopt.mockImplementation(async (
            _shown: unknown, _status: unknown, options?: TakeOverOptions,
        ) => {
            if (env.outcome !== 'untouched' && options?.onTrackTaken) await options.onTrackTaken({ id: 'other' }, () => true);
            return env.outcome;
        });
        env.stopForeign.mockClear();
        env.coverDropped.mockClear();
        env.lyricsSet.mockClear();
        env.lyricsLoading.length = 0;
    });

    afterEach(() => {
        for (const effect of env.effects) effect.cleanup?.();
        env.effects.length = 0;
        env.listener = null;
        vi.useRealTimers();
    });

    it('takes it over in place of the song on screen, a pause there included', async () => {
        const fire = MountBridge();

        fire({ type: 'track-changed', status: env.status });
        await vi.advanceTimersByTimeAsync(0);

        expect(env.adopt).toHaveBeenCalledTimes(1);
        const [shown, status, options] = env.adopt.mock.calls[0] as [unknown, unknown, { adoptsPausedTrack?: boolean }];
        expect(shown).toEqual({ id: 'song' });
        expect(status).toBe(env.status);
        // The listener's own pause in the player is followed, not stopped.
        expect(options.adoptsPausedTrack).toBe(true);
    });

    it('never stops the player for a track it took over', async () => {
        const fire = MountBridge();

        fire({ type: 'track-changed', status: env.status });
        await vi.advanceTimersByTimeAsync(0);

        expect(env.stopForeign).not.toHaveBeenCalled();
    });

    // f25db71e5: the take-over reported a track shown paused, which is on screen just as an adopted
    // one is. Stopping there left a paused track on screen with its player stopped behind it.
    it('never stops the player for a track it only showed paused', async () => {
        env.outcome = 'shown';
        const fire = MountBridge();

        fire({ type: 'track-changed', status: env.status });
        await vi.advanceTimersByTimeAsync(0);

        expect(env.adopt).toHaveBeenCalledTimes(1);
        expect(env.stopForeign).not.toHaveBeenCalled();
    });

    // A track taken over is shown with its own cover and lyrics: the ones of the song it replaced
    // are cleared first, and the words it has not said yet are shown as loading rather than as the
    // previous song's.
    it('clears the cover and the lyrics of the replaced song, and says a lookup is on its way', async () => {
        const fire = MountBridge();

        fire({ type: 'track-changed', status: env.status });
        await vi.advanceTimersByTimeAsync(0);

        expect(env.coverDropped).toHaveBeenCalledTimes(1);
        expect(env.lyricsSet).toHaveBeenCalledWith(null);
        expect(env.lyricsLoading[0]).toBe(true);
    });

    it('writes nothing of the song it replaced where the track was not taken over', async () => {
        env.outcome = 'untouched';
        const fire = MountBridge();

        fire({ type: 'track-changed', status: env.status });
        await vi.advanceTimersByTimeAsync(0);

        expect(env.coverDropped).not.toHaveBeenCalled();
        expect(env.lyricsSet).not.toHaveBeenCalled();
    });

    it('leaves the player sounding where nothing of the track could be taken', async () => {
        env.outcome = 'untouched';
        const fire = MountBridge();

        fire({ type: 'track-changed', status: env.status });
        await vi.advanceTimersByTimeAsync(0);

        expect(env.adopt).toHaveBeenCalledTimes(1);
        expect(env.stopForeign).not.toHaveBeenCalled();
    });

    it('leaves the player sounding where the take-over threw', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        env.adopt.mockImplementation(() => Promise.reject(new Error('the lookup failed')));
        const fire = MountBridge();

        fire({ type: 'track-changed', status: env.status });
        await vi.advanceTimersByTimeAsync(0);

        expect(env.stopForeign).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});
