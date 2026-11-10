// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/hifi/useHifiMpris.test.ts
// Linux 上 HiFi 的系统媒体控制交给主进程的 MPRIS（#835）：只在 Linux、HiFi 路线上有曲目时推状态，跳转时带 seeked，
// 离开路线时推不活动；封面读成字节交过去，读不到时 http(s) 交原址；按键照页面 Media Session 的处理走。

vi.hoisted(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key), clear: () => values.clear(),
    } });
});

const { PlayerState } = await import('@/types');
const { useHifiMpris, readMprisArtwork, mprisStatusOf, hasMainProcessMediaControls, useHifiMprisStatusStore } = await import('@/components/hifi/useHifiMpris');
const { hifiMediaShim } = await import('@/services/hifi/hifiMediaShim');
const { useHifiTrackStore } = await import('@/services/hifi/hifiTrackStore');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { getPlaybackSongKey } = await import('@/utils/appPlaybackGuards');

type Command = 'play' | 'pause' | 'playpause' | 'stop' | 'next' | 'previous';

let root: Root | null = null;
let setMprisState: ReturnType<typeof vi.fn>;
let setMprisArtwork: ReturnType<typeof vi.fn>;
let commandListener: ((command: Command) => void) | null;
let statusListener: ((status: { registered: boolean }) => void) | null;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const song = {
    id: 1,
    name: '晴天',
    artists: [{ id: 1, name: '周杰伦' }],
    album: { id: 2, name: '叶惠美' },
} as never;

const refs = () => ({
    mediaSessionPlayRef: { current: vi.fn(async () => {}) },
    mediaSessionPauseRef: { current: vi.fn() },
    mediaSessionPrevRef: { current: vi.fn() },
    mediaSessionNextRef: { current: vi.fn() },
    isNowPlayingControlDisabledRef: { current: false },
});

type Options = Parameters<typeof useHifiMpris>[0];

const render = (options: Options) => {
    function Probe(props: { options: Options }) {
        useHifiMpris(props.options);
        return null;
    }
    root ??= createRoot(document.createElement('div'));
    act(() => root!.render(React.createElement(Probe, { options })));
};

const options = (overrides: Partial<Options> = {}): Options => ({
    currentSong: song,
    cachedCoverUrl: null,
    playerState: PlayerState.PLAYING,
    isNowPlayingStageActive: false,
    unknownArtistLabel: 'Unknown',
    ...refs(),
    ...overrides,
} as Options);

/** A HiFi track as beginHifiTrack shows it: the route on hifi, the shim on its trackKey, the track store on its song. */
const showHifiTrack = (trackKey: string, trackSong: unknown = song) => act(() => {
    hifiMediaShim.beginTrack(trackKey);
    useHifiTrackStore.setState({ current: {
        trackKey, songKey: getPlaybackSongKey(trackSong as never), origin: 'local', song: trackSong as never, localSourceKey: 'k',
    } as never });
    usePlaybackStore.setState({ playbackRoute: 'hifi' });
});

const lastState = () => setMprisState.mock.calls.at(-1)?.[0];
// jsdom's Blob has no arrayBuffer(): a stand-in with what readMprisArtwork reads.
const imageBlob = (bytes: number[]) => ({
    size: bytes.length,
    type: 'image/png',
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
});

beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    setMprisState = vi.fn(async () => {});
    setMprisArtwork = vi.fn(async () => {});
    commandListener = null;
    statusListener = null;
    useHifiMprisStatusStore.setState({ registered: null });
    (window as unknown as { electron?: unknown }).electron = {
        platform: 'linux',
        hifi: {
            setMprisState,
            setMprisArtwork,
            onMprisCommand: (callback: (command: Command) => void) => {
                commandListener = callback;
                return () => { commandListener = null; };
            },
            onMprisStatus: (callback: (status: { registered: boolean }) => void) => {
                statusListener = callback;
                return () => { statusListener = null; };
            },
        },
    };
    usePlaybackStore.setState({ playbackRoute: 'web' });
    useHifiTrackStore.setState({ current: null });
    hifiMediaShim.reset();
});

afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null;
    hifiMediaShim.reset();
    delete (window as unknown as { electron?: unknown }).electron;
    vi.restoreAllMocks();
});

describe('helpers', () => {
    it('maps the player state the way the page Media Session does', () => {
        expect(mprisStatusOf(PlayerState.PLAYING, false)).toBe('Playing');
        expect(mprisStatusOf(PlayerState.PAUSED, false)).toBe('Paused');
        expect(mprisStatusOf(PlayerState.PLAYING, true)).toBe('Stopped');
    });

    it('says main gives the media controls only on Linux with the preload methods', () => {
        expect(hasMainProcessMediaControls()).toBe(true);
        (window as unknown as { electron: { platform: string } }).electron.platform = 'win32';
        expect(hasMainProcessMediaControls()).toBe(false);
        (window as unknown as { electron: unknown }).electron = { platform: 'linux', hifi: {} };
        expect(hasMainProcessMediaControls()).toBe(false);
    });

    it('reads the cover as bytes, falls back to an http(s) address, and gives nothing for others', async () => {
        const png = imageBlob([1, 2, 3]);
        const ok = vi.fn(async () => ({ ok: true, blob: async () => png }) as unknown as Response);
        await expect(readMprisArtwork('blob:x', ok)).resolves.toEqual({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' });
        const fails = vi.fn(async () => { throw new TypeError('CORS'); });
        await expect(readMprisArtwork('https://nd.example/c?t=secret', fails)).resolves.toEqual({ url: 'https://nd.example/c?t=secret' });
        await expect(readMprisArtwork('folia-local://cover', fails)).resolves.toBeNull();
        // The address may carry credentials: it never reaches the log.
        expect(JSON.stringify((console.info as ReturnType<typeof vi.fn>).mock.calls)).not.toContain('secret');
    });
});

describe('useHifiMpris', () => {
    it('stays quiet off the HiFi route and pushes the track once HiFi has it', () => {
        render(options());
        // Nothing was pushed active yet, so there is nothing to clear.
        expect(setMprisState).not.toHaveBeenCalled();

        showHifiTrack('t1');
        expect(lastState()).toMatchObject({
            active: true,
            trackKey: 't1',
            title: '晴天',
            artists: ['周杰伦'],
            album: '叶惠美',
            status: 'Playing',
            seeked: false,
        });
    });

    it('pushes nothing on the web route however the song or the state changes', () => {
        render(options());
        render(options({ playerState: PlayerState.PAUSED }));
        render(options({ playerState: PlayerState.PLAYING }));
        expect(setMprisState).not.toHaveBeenCalled();
    });

    it('keeps what main reports about registering MPRIS, so the keep-alive can come back when it could not', () => {
        render(options());
        expect(hasMainProcessMediaControls()).toBe(true);
        act(() => statusListener!({ registered: false }));
        expect(useHifiMprisStatusStore.getState().registered).toBe(false);
        expect(hasMainProcessMediaControls()).toBe(false);
        act(() => statusListener!({ registered: true }));
        expect(hasMainProcessMediaControls()).toBe(true);
    });

    it('re-pushes on pause and duration, flags a seek, and goes inactive when the route leaves HiFi', () => {
        render(options());
        showHifiTrack('t1');
        act(() => hifiMediaShim.setDuration(200));
        expect(lastState()).toMatchObject({ durationSec: 200 });
        act(() => hifiMediaShim.markPlaying());
        act(() => hifiMediaShim.markSeeked());
        expect(setMprisState.mock.calls.some(([state]) => state.seeked === true)).toBe(true);

        render(options({ playerState: PlayerState.PAUSED }));
        expect(lastState()).toMatchObject({ status: 'Paused', seeked: false });

        act(() => usePlaybackStore.setState({ playbackRoute: 'web' }));
        expect(lastState()).toEqual({ active: false });
    });

    it('describes the HiFi track own song while the displayed song still names the one before (gapless switch)', () => {
        const next = { id: 2, name: '七里香', artists: [{ id: 1, name: '周杰伦' }], album: { id: 3, name: '七里香' } } as never;
        render(options());
        showHifiTrack('t1');
        // mpv moved on: the track store names the next song before the player's displayed song follows.
        showHifiTrack('t2', next);
        expect(lastState()).toMatchObject({ trackKey: 't2', title: '七里香' });
        expect(setMprisState.mock.calls.some(([state]) => state.trackKey === 't2' && state.title === '晴天')).toBe(false);
        render(options({ currentSong: next }));
        expect(lastState()).toMatchObject({ trackKey: 't2', title: '七里香' });
    });

    it('lists the unknown-artist label when the song has no artist', () => {
        const bare = { id: 1, name: 'x', artists: [], album: { id: 0, name: '' } } as never;
        render(options({ currentSong: bare }));
        showHifiTrack('t1', bare);
        expect(lastState()).toMatchObject({ artists: ['Unknown'] });
    });

    it('sends the cover of the track it pushed', async () => {
        const png = imageBlob([9]);
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => png })));
        render(options({ cachedCoverUrl: 'blob:cover' }));
        showHifiTrack('t1');
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        expect(setMprisArtwork).toHaveBeenCalledWith('t1', { bytes: new Uint8Array([9]), mimeType: 'image/png' });
        vi.unstubAllGlobals();
    });

    it('runs the media keys like the page Media Session, and not while disabled or off HiFi', () => {
        const opts = options();
        render(opts);
        showHifiTrack('t1');
        act(() => {
            commandListener!('playpause');
            commandListener!('stop');
            commandListener!('next');
            commandListener!('previous');
        });
        expect(opts.mediaSessionPauseRef.current).toHaveBeenCalledTimes(2);
        expect(opts.mediaSessionNextRef.current).toHaveBeenCalledTimes(1);
        expect(opts.mediaSessionPrevRef.current).toHaveBeenCalledTimes(1);

        render({ ...opts, playerState: PlayerState.PAUSED });
        act(() => commandListener!('playpause'));
        expect(opts.mediaSessionPlayRef.current).toHaveBeenCalledTimes(1);

        opts.isNowPlayingControlDisabledRef.current = true;
        act(() => commandListener!('play'));
        expect(opts.mediaSessionPlayRef.current).toHaveBeenCalledTimes(1);

        opts.isNowPlayingControlDisabledRef.current = false;
        act(() => usePlaybackStore.setState({ playbackRoute: 'web' }));
        act(() => commandListener!('play'));
        expect(opts.mediaSessionPlayRef.current).toHaveBeenCalledTimes(1);
    });

    it('does nothing off Linux', () => {
        (window as unknown as { electron: { platform: string } }).electron.platform = 'darwin';
        render(options());
        showHifiTrack('t1');
        expect(setMprisState).not.toHaveBeenCalled();
        expect(commandListener).toBeNull();
    });

    it('goes inactive when App unmounts', () => {
        render(options());
        showHifiTrack('t1');
        act(() => root!.unmount());
        root = null;
        expect(lastState()).toEqual({ active: false });
    });
});
