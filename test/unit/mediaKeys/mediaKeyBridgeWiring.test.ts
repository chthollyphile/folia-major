// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/mediaKeys/mediaKeyBridgeWiring.test.ts
// 一次物理媒体键可能落到两条路径上：主进程在 globalShortcut 上占住的那三个键（交付给
// useMediaKeyTakeoverBridge 的 onExternalMediaKey），和应用自己的媒体会话（useMediaSessionBridge
// 的四个 action handler）。两条路径共用 mediaKeyPressGate 的这一份记录，同一个动作只执行一次。
// 这里钉的是接线：五个入口都确实去 claim，被挡下的那一个什么都不做，而它放行的那个照常执行。

// 这种方式（Soloist / 官方客户端）的播放方式从桌面侧读，桥的挂载就要读到它。
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

/** 媒体会话上挂着的 handler，按 action 名取。 */
const handlers = new Map<string, ActionHandler>();

const runTransportAction = vi.fn((_action: string) => {});
const playSong = vi.fn(async () => {});
const play = vi.fn(async () => {});
const pause = vi.fn(() => {});
const previous = vi.fn(() => {});
const next = vi.fn(async () => {});

let deliverKey: ((action: string) => void) | null = null;
const setExternalMediaKeys = vi.fn(async (enabled: boolean) => ({ enabled, held: enabled ? ['MediaPlayPause'] : [] }));

let root: Root | null = null;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 隔开一次按键的时间：同一动作在 SAME_PRESS_MS 内的两次到达算同一次按键。 */
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

/** 只挂媒体会话那一条路径。 */
const renderMediaSession = () => {
    root = createRoot(document.createElement('div'));
    act(() => { root!.render(React.createElement(MediaSessionProbe)); });
};

/** 两条路径都挂着：一次按键两条都可能收到。 */
const renderBothPaths = () => {
    root = createRoot(document.createElement('div'));
    act(() => { root!.render(React.createElement(() => React.createElement(React.Fragment, null,
        React.createElement(MediaSessionProbe),
        React.createElement(TakeoverProbe),
    ))); });
};

beforeEach(async () => {
    // 共用记录是上一次用例留下的：先隔开一次按键的时间，它不会挡住这一次。
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

        // 同一次按键的第二次到达（只是另一个动作名）：什么都不做。
        await act(async () => { await handlers.get('pause')!(); });
        expect(pause).not.toHaveBeenCalled();

        await act(async () => { await handlers.get('nexttrack')!(); });
        expect(next).toHaveBeenCalledTimes(1);
        await act(async () => { await handlers.get('previoustrack')!(); });
        expect(previous).toHaveBeenCalledTimes(1);

        // 隔开一次按键的时间之后，同一个动作就是另一次按键。
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
