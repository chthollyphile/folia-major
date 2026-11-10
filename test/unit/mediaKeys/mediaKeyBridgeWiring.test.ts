// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/mediaKeys/mediaKeyBridgeWiring.test.ts
// One physical media key can reach two paths: the three keys the main process holds on
// globalShortcut (delivered to useMediaKeyTakeoverBridge as onExternalMediaKey), and the app's own
// media session (useMediaSessionBridge's four action handlers). Both share mediaKeyPressGate's one
// record, so an action runs once. What is pinned here is the wiring: all five entries really claim,
// the one held back does nothing, and the one let through runs as usual.

// Mounting the bridge asks the desktop side whether this way of playing (Soloist / the official
// client) wants the keys, so this gives it an answer it can use.
vi.mock('@/services/onlineMusic/spotify/spotifyTransport', () => ({
    requestSpotify: vi.fn(async () => ({ available: true })),
    getSpotifyTransportAvailability: () => ({ configured: true }),
}));

const { useMediaSessionBridge } = await import('@/hooks/useMediaSessionBridge');
const { useMediaKeyTakeoverBridge } = await import('@/components/app/playback/bridges/useMediaKeyTakeoverBridge');
const { SAME_PRESS_MS } = await import('@/utils/mediaKeyPressGate');
const { PlayerState } = await import('@/types');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');

type ActionHandler = (details?: unknown) => void | Promise<void>;

/** The handlers the media session has attached, by action name. */
const handlers = new Map<string, ActionHandler>();

const runTransportAction = vi.fn(() => {});
const playSong = vi.fn(async () => {});
const play = vi.fn(async () => {});
const pause = vi.fn(() => {});
const previous = vi.fn(() => {});
const next = vi.fn(async () => {});

let deliverKey: ((action: string) => void) | null = null;
const setExternalMediaKeys = vi.fn(async (enabled: boolean) => ({ enabled, held: enabled ? ['MediaPlayPause'] : [] }));

let root: Root | null = null;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Waits out one press: the same action arriving twice within SAME_PRESS_MS counts as one press. */
const sleepPastOnePress = () => new Promise(resolve => setTimeout(resolve, SAME_PRESS_MS + 30));

const installMediaSession = () => {
    handlers.clear();
    Object.defineProperty(navigator, 'mediaSession', {
        configurable: true,
        value: {
            setActionHandler: (action: string, handler: ActionHandler | null) => {
                if (handler) handlers.set(action, handler);
                else handlers.delete(action);
            },
            setPositionState: () => {},
            metadata: null,
            playbackState: 'none',
        },
    });
};

const installElectron = () => {
    deliverKey = null;
    setExternalMediaKeys.mockClear();
    (window as unknown as { electron?: unknown }).electron = {
        setExternalMediaKeys,
        onExternalMediaKey: (callback: (action: string) => void) => {
            deliverKey = callback;
            return () => { deliverKey = null; };
        },
    };
};

const audioRef = { current: null as HTMLAudioElement | null };

const MediaSessionProbe = () => {
    useMediaSessionBridge({
        audioRef,
        audioSrc: null,
        currentSong: null,
        cachedCoverUrl: null,
        playerState: PlayerState.PAUSED,
        isNowPlayingStageActive: false,
        unknownArtistLabel: 'Unknown',
        mediaSessionPlayRef: { current: play },
        mediaSessionPauseRef: { current: pause },
        mediaSessionPrevRef: { current: previous },
        mediaSessionNextRef: { current: next },
        isNowPlayingControlDisabledRef: { current: false },
    });
    return null;
};

const TakeoverProbe = () => {
    useMediaKeyTakeoverBridge({ runTransportAction, playSong });
    return null;
};

/** Only the media session's path is mounted. */
const renderMediaSession = () => {
    root = createRoot(document.createElement('div'));
    act(() => { root!.render(React.createElement(MediaSessionProbe)); });
};

/** Both paths are mounted: one press may reach both. */
const renderBothPaths = () => {
    root = createRoot(document.createElement('div'));
    act(() => { root!.render(React.createElement(() => React.createElement(React.Fragment, null,
        React.createElement(MediaSessionProbe),
        React.createElement(TakeoverProbe),
    ))); });
};

beforeEach(async () => {
    // The shared record is left over from the case before: wait out one press, so it does not block this one.
    await sleepPastOnePress();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const spy of [runTransportAction, playSong, play, pause, previous, next]) spy.mockClear();
    audioRef.current = document.createElement('audio');
    usePlaybackStore.setState({ playbackRoute: 'web', playerState: PlayerState.PAUSED });
    installMediaSession();
    installElectron();
});

afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null;
    deliverKey = null;
    delete (navigator as { mediaSession?: unknown }).mediaSession;
    delete (window as unknown as { electron?: unknown }).electron;
    vi.restoreAllMocks();
});

describe('the media session handlers', () => {
    it('claims the press each of the four handlers runs', async () => {
        renderMediaSession();
        await act(async () => { await handlers.get('play')!(); });
        expect(play).toHaveBeenCalledTimes(1);

        // The same press arriving again (only under another action name): nothing runs.
        await act(async () => { await handlers.get('pause')!(); });
        expect(pause).not.toHaveBeenCalled();

        await act(async () => { await handlers.get('nexttrack')!(); });
        expect(next).toHaveBeenCalledTimes(1);
        await act(async () => { await handlers.get('previoustrack')!(); });
        expect(previous).toHaveBeenCalledTimes(1);

        // Once one press has gone by, the same action is another press.
        await sleepPastOnePress();
        await act(async () => { await handlers.get('pause')!(); });
        expect(pause).toHaveBeenCalledTimes(1);
    });
});

describe('one press reaching both paths', () => {
    it('runs the shortcut press and drops the media session copy of it', async () => {
        renderBothPaths();
        await act(async () => { deliverKey!('play-pause'); });
        expect(runTransportAction).toHaveBeenCalledWith('play-pause');

        await act(async () => { await handlers.get('play')!(); });
        expect(play).not.toHaveBeenCalled();
    });

    it('runs the media session press and drops the shortcut copy of it', async () => {
        renderBothPaths();
        await act(async () => { await handlers.get('nexttrack')!(); });
        expect(next).toHaveBeenCalledTimes(1);

        await act(async () => { deliverKey!('next'); });
        expect(runTransportAction).not.toHaveBeenCalled();
    });
});

describe('what the bridge asks the main process for', () => {
    it('asks for nothing while the app\'s own decks sound the song', async () => {
        // A local or built-in song: the keys stay the app's own media session's, as before this route.
        usePlaybackStore.setState({ playbackRoute: 'web', currentSong: { id: 'local' } as never });
        renderBothPaths();
        await act(async () => { await Promise.resolve(); });

        // The mount's unconditional wish, and nothing that asks for them.
        expect(setExternalMediaKeys).toHaveBeenCalled();
        for (const call of setExternalMediaKeys.mock.calls) expect(call[0]).toBe(false);
    });

    it('asks for nothing while the external player holds no song, and gives back the keys it held', async () => {
        usePlaybackStore.setState({ playbackRoute: 'external', currentSong: { id: 'gone' } as never });
        renderBothPaths();
        await act(async () => { await Promise.resolve(); });
        for (const call of setExternalMediaKeys.mock.calls) expect(call[0]).toBe(false);

        // The player stopped on that route: still nothing is held.
        setExternalMediaKeys.mockClear();
        await act(async () => {
            usePlaybackStore.setState({ playbackRoute: 'external', currentSong: null });
        });
        await act(async () => { await Promise.resolve(); });
        for (const call of setExternalMediaKeys.mock.calls) expect(call[0]).toBe(false);
    });

    it('asks for nothing for a player that did not declare the keys while its song sounds', async () => {
        // The route and a song are both there, but no provider declared this one as Folia's: the keys
        // stay the app's own media session's. That is what the switch alone must never override.
        usePlaybackStore.setState({ playbackRoute: 'external', currentSong: { id: 'x' } as never });
        renderBothPaths();
        await act(async () => { await Promise.resolve(); });
        for (const call of setExternalMediaKeys.mock.calls) expect(call[0]).toBe(false);

        // The provider declares nothing here either, so a store change asks for nothing new.
        setExternalMediaKeys.mockClear();
        await act(async () => {
            usePlaybackStore.setState({ playbackRoute: 'external', currentSong: { id: 'y' } as never });
        });
        await act(async () => { await Promise.resolve(); });
        for (const call of setExternalMediaKeys.mock.calls) expect(call[0]).toBe(false);
    });
});
