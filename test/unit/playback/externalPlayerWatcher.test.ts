// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/playback/externalPlayerWatcher.test.ts
// The slow watcher the bridge runs while a way of playing that follows the listener's own changes is
// set and nothing of Folia is sounding in that player: every three seconds it reads the player once,
// so a song the listener starts in the player's own window is picked up too - not only the one that
// was running when Folia was reopened. It never reads while the page is hidden, and it stops with the
// bridge. A way that declared nothing is never read: Apple Music keeps its own behaviour.

const env = vi.hoisted(() => ({
    effects: [] as Array<{ run: () => unknown; cleanup?: () => void }>,
    traits: { followsPlayerChanges: true } as Record<string, boolean>,
    externalRoute: false,
    externalSong: null as unknown,
    currentSong: { id: 'song', name: 'Song', artists: [], album: { id: '', name: 'Album' }, durationMs: 1000 },
    follow: vi.fn(async () => 'none'),
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
    subscribeExternalPlayback: () => () => {},
    isExternalRoute: () => env.externalRoute,
    getExternalSong: () => env.externalSong,
    isExternalTakeoverPending: () => false,
    stopForeignExternalPlayback: () => {},
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
    const read = () => ({ currentSong: env.currentSong, playbackRoute: env.externalRoute ? 'external' : 'web', playQueue: [] });
    const store = (selector?: (state: unknown) => unknown) => (selector ? selector(read()) : read());
    return { usePlaybackStore: Object.assign(store, { getState: read, subscribe: () => () => {} }) };
});
vi.mock('@/components/app/playback/bridges/externalPlayerFollow', () => ({
    followsPlayerChangesForShownSong: () => env.traits.followsPlayerChanges === true,
    followRunningExternalPlayer: () => env.follow(),
    takeOverRunningPlayer: vi.fn(async () => 'untouched'),
}));

const { useExternalPlaybackBridge } = await import('@/components/app/playback/bridges/useExternalPlaybackBridge');

/**
 * Mounts the bridge: every effect it declares runs, and what each returned is kept for the
 * unmount. Named as a component because that is what it stands in for: the hook is only ever
 * called while one is being mounted.
 */
const MountBridge = () => {
    env.effects.length = 0;
    useExternalPlaybackBridge({ handleNextTrack: vi.fn(), handlePrevTrack: vi.fn() });
    for (const effect of env.effects) effect.cleanup = effect.run() as (() => void) | undefined;
};

const unmountBridge = () => {
    for (const effect of env.effects) effect.cleanup?.();
    env.effects.length = 0;
};

const setHidden = (hidden: boolean) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
};

describe('the watcher of a player that follows its listener', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        env.traits = { followsPlayerChanges: true };
        env.externalRoute = false;
        env.externalSong = null;
        env.follow.mockClear();
        setHidden(false);
    });

    afterEach(() => {
        unmountBridge();
        setHidden(false);
        vi.useRealTimers();
    });

    it('reads the player every three seconds', async () => {
        MountBridge();
        expect(env.follow).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(2999);
        expect(env.follow).toHaveBeenCalledTimes(0);
        await vi.advanceTimersByTimeAsync(1);
        expect(env.follow).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(3000);
        expect(env.follow).toHaveBeenCalledTimes(2);
    });

    it('never reads a way of playing that declared it does not follow', async () => {
        env.traits = { followsPlayerChanges: false };
        MountBridge();

        await vi.advanceTimersByTimeAsync(10_000);
        expect(env.follow).not.toHaveBeenCalled();
    });

    it('never reads while a session of this route already follows the player', async () => {
        env.externalRoute = true;
        env.externalSong = env.currentSong;
        MountBridge();

        await vi.advanceTimersByTimeAsync(10_000);
        expect(env.follow).not.toHaveBeenCalled();
    });

    it('reads again where the route is the external one but no player is held', async () => {
        env.externalRoute = true;
        env.externalSong = null;
        MountBridge();

        await vi.advanceTimersByTimeAsync(3000);
        expect(env.follow).toHaveBeenCalledTimes(1);
    });

    it('stops while the page is hidden and picks the player up again when it shows', async () => {
        MountBridge();
        await vi.advanceTimersByTimeAsync(3000);
        expect(env.follow).toHaveBeenCalledTimes(1);

        setHidden(true);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(env.follow).toHaveBeenCalledTimes(1);

        // Shown again: that read is the first, and the ordinary interval goes on from there.
        setHidden(false);
        await vi.advanceTimersByTimeAsync(0);
        expect(env.follow).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(3000);
        expect(env.follow).toHaveBeenCalledTimes(3);
    });

    it('reads the player as soon as the page shows again, not a whole interval later', async () => {
        MountBridge();
        await vi.advanceTimersByTimeAsync(3000);
        expect(env.follow).toHaveBeenCalledTimes(1);

        setHidden(true);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(env.follow).toHaveBeenCalledTimes(1);

        // The page is the listener's again: waiting out the interval would leave what they just
        // started in the player unseen for up to three seconds.
        setHidden(false);
        await vi.advanceTimersByTimeAsync(0);
        expect(env.follow).toHaveBeenCalledTimes(2);
    });

    it('stops with the bridge', async () => {
        MountBridge();
        await vi.advanceTimersByTimeAsync(3000);
        expect(env.follow).toHaveBeenCalledTimes(1);

        unmountBridge();
        await vi.advanceTimersByTimeAsync(10_000);
        expect(env.follow).toHaveBeenCalledTimes(1);
    });

    it('asks nothing more while the previous read is still on its way', async () => {
        let settle!: (value: string) => void;
        env.follow.mockImplementation(() => new Promise(resolve => { settle = resolve; }));
        MountBridge();

        await vi.advanceTimersByTimeAsync(9000);
        expect(env.follow).toHaveBeenCalledTimes(1);

        settle('none');
        await vi.advanceTimersByTimeAsync(3000);
        expect(env.follow).toHaveBeenCalledTimes(2);
    });
});
