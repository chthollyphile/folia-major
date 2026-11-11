// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/playback/externalFollowTrackChanged.test.ts
// What the bridge does when the route reports that the player moved on to a track Folia did not ask
// for: that track is taken over in place of the song on screen, and the player is only stopped where
// nothing was taken. A track taken over is either the player's now (adopted) or shown paused where
// it is (shown): both are on screen, so neither is stopped - f25db71e5 is the commit that fixed a
// pause being stopped here. A take-over that took nothing and one that threw leave the player
// sounding a song Folia knows nothing about, so both stop it.

const env = vi.hoisted(() => ({
    effects: [] as Array<{ run: () => unknown; cleanup?: () => void }>,
    listener: null as null | ((event: unknown) => void),
    traits: { followsPlayerChanges: true } as Record<string, boolean>,
    externalRoute: true,
    externalSong: { id: 'song' } as unknown,
    outcome: 'adopted' as string,
    adopt: vi.fn(),
    stopForeign: vi.fn(),
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
    const read = () => ({ currentSong: { id: 'song' }, playbackRoute: 'external', playQueue: [] });
    const store = (selector?: (state: unknown) => unknown) => (selector ? selector(read()) : read());
    return { usePlaybackStore: Object.assign(store, { getState: read, subscribe: () => () => {} }) };
});
vi.mock('@/components/app/playback/bridges/externalPlayerFollow', () => ({
    followsPlayerChangesForShownSong: () => env.traits.followsPlayerChanges === true,
    followRunningExternalPlayer: async () => 'untouched',
    adoptPlayerTrack: (...args: unknown[]) => env.adopt(...args),
}));

const { useExternalPlaybackBridge } = await import('@/components/app/playback/bridges/useExternalPlaybackBridge');

/** Mounts the bridge and hands back the listener the route reports through. */
const mountBridge = () => {
    env.effects.length = 0;
    env.listener = null;
    useExternalPlaybackBridge({ handleNextTrack: vi.fn(), handlePrevTrack: vi.fn() });
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
        env.adopt.mockImplementation(async () => env.outcome);
        env.stopForeign.mockClear();
    });

    afterEach(() => {
        for (const effect of env.effects) effect.cleanup?.();
        env.effects.length = 0;
        env.listener = null;
        vi.useRealTimers();
    });

    it('takes it over in place of the song on screen, a pause there included', async () => {
        const fire = mountBridge();

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
        const fire = mountBridge();

        fire({ type: 'track-changed', status: env.status });
        await vi.advanceTimersByTimeAsync(0);

        expect(env.stopForeign).not.toHaveBeenCalled();
    });

    // f25db71e5: the take-over reported a track shown paused, which is on screen just as an adopted
    // one is. Stopping there left a paused track on screen with its player stopped behind it.
    it('never stops the player for a track it only showed paused', async () => {
        env.outcome = 'shown';
        const fire = mountBridge();

        fire({ type: 'track-changed', status: env.status });
        await vi.advanceTimersByTimeAsync(0);

        expect(env.adopt).toHaveBeenCalledTimes(1);
        expect(env.stopForeign).not.toHaveBeenCalled();
    });

    it('stops the player where nothing of the track could be taken', async () => {
        env.outcome = 'untouched';
        const fire = mountBridge();

        fire({ type: 'track-changed', status: env.status });
        await vi.advanceTimersByTimeAsync(0);

        expect(env.stopForeign).toHaveBeenCalledTimes(1);
    });

    it('stops the player where the take-over threw', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        env.adopt.mockImplementation(() => Promise.reject(new Error('the lookup failed')));
        const fire = mountBridge();

        fire({ type: 'track-changed', status: env.status });
        await vi.advanceTimersByTimeAsync(0);

        expect(env.stopForeign).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});
