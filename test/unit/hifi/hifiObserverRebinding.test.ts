// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import { PlayerState } from '@/types';

// test/unit/hifi/hifiObserverRebinding.test.ts
// 只观察播放的模块换到 HiFi 媒体 shim：同一首歌、只换了路线（接管窗口重建前的播放、回落 Web）时也要跟过去。
// Navidrome 的 scrobble 监听原来只跟着 deck 换绑，Media Session 原来拿 <audio> 的 src 比对，HiFi 上 audioSrc 是 null。

vi.hoisted(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key), clear: () => values.clear(),
    } });
});
const navidrome = vi.hoisted(() => ({ scrobble: vi.fn(async (..._args: unknown[]) => true) }));
vi.mock('@/services/navidromeService', () => ({
    getNavidromeConfig: () => ({ serverUrl: 'https://navi.example.com', username: 'lia' }),
    navidromeApi: navidrome,
}));
vi.mock('@/services/onlineMusic/songMetadata', () => ({
    getProviderSongMetadata: (song: SongResult | null) => ({ durationMs: song?.durationMs ?? 0, artists: [], album: { id: 0, name: '' }, aliases: [], translatedNames: [] }),
    getSongArtistLabel: () => 'Artist',
    getSongAlbumLabel: () => 'Album',
    getSongCoverUrl: () => undefined,
}));

const { useNavidromeScrobbleReporter } = await import('@/hooks/useNavidromeScrobbleReporter');
const { useMediaSessionBridge } = await import('@/hooks/useMediaSessionBridge');
const { hifiMediaShim } = await import('@/services/hifi/hifiMediaShim');
const { useHifiTrackStore } = await import('@/services/hifi/hifiPlayback');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');

const navidromeSong = {
    id: 'nd-1',
    name: 'Remote',
    durationMs: 200_000,
    isNavidrome: true,
    sourceRef: { kind: 'navidrome', mediaId: 'nd-1' },
    navidromeData: { id: 'nd-1', streamUrl: 'https://navi.example.com/rest/stream?id=nd-1', suffix: 'flac' },
} as unknown as SongResult;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let position = 0;

const render = (element: React.ReactElement) => {
    root = createRoot(document.createElement('div'));
    act(() => root!.render(element));
};

/** shim 换到一首 HiFi 曲目，就像 hifiPlayback 的 showHifiTrack 那样：先 beginTrack，再让曲目 store 叫出它。 */
const showHifiTrack = (trackKey: string) => act(() => {
    hifiMediaShim.beginTrack(trackKey);
    useHifiTrackStore.setState({
        current: { trackKey, songKey: 'navidrome:nd-1', origin: 'navidrome', song: navidromeSong, localSourceKey: null },
        loadState: 'loading',
    });
});

beforeEach(() => {
    position = 0;
    hifiMediaShim.setClockReader(() => position);
    hifiMediaShim.reset();
    usePlaybackStore.setState({ playbackRoute: 'web', audioSrc: null });
    useHifiTrackStore.setState({ current: null, loadState: 'idle' });
    navidrome.scrobble.mockClear();
});

afterEach(() => {
    act(() => root?.unmount());
    root = null;
    hifiMediaShim.reset();
    usePlaybackStore.setState({ playbackRoute: 'web' });
});

describe('Navidrome scrobble on the HiFi route', () => {
    it('moves its listeners onto the shim when only the route changes', () => {
        const deck = Object.assign(new EventTarget(), { currentTime: 0, paused: true, ended: false, duration: Number.NaN });
        const audioRef = { current: deck as unknown as HTMLAudioElement };
        function Probe() {
            useNavidromeScrobbleReporter({ audioRef, currentSong: navidromeSong, activeDeck: 'A' });
            return null;
        }
        render(React.createElement(Probe));

        // Same song, same deck: only the route moved (mpv took over the song).
        act(() => usePlaybackStore.setState({ playbackRoute: 'hifi' }));
        showHifiTrack('navidrome:nd-1#a');
        hifiMediaShim.setDuration(200);
        hifiMediaShim.markPlaying();
        expect(navidrome.scrobble).toHaveBeenCalledTimes(1);
        expect(navidrome.scrobble).toHaveBeenNthCalledWith(1, expect.anything(), 'nd-1', expect.objectContaining({ submission: false }));

        // The deck is silent on the HiFi route: its events are no longer listened to.
        Object.assign(deck, { paused: false, currentTime: 150 });
        deck.dispatchEvent(new Event('timeupdate'));
        expect(navidrome.scrobble).toHaveBeenCalledTimes(1);

        position = 120;
        hifiMediaShim.dispatchEvent(new Event('timeupdate'));
        expect(navidrome.scrobble).toHaveBeenCalledTimes(2);
        expect(navidrome.scrobble).toHaveBeenNthCalledWith(2, expect.anything(), 'nd-1', expect.objectContaining({ submission: true }));
        hifiMediaShim.reset();
    });
});

describe('Media Session on the HiFi route', () => {
    const mediaSession = {
        metadata: null as unknown,
        playbackState: 'none',
        setActionHandler: vi.fn(),
        setPositionState: vi.fn(),
    };

    beforeEach(() => {
        mediaSession.metadata = null;
        mediaSession.setPositionState.mockClear();
        Object.defineProperty(navigator, 'mediaSession', { configurable: true, value: mediaSession });
        (globalThis as { MediaMetadata?: unknown }).MediaMetadata = class {
            constructor(init: Record<string, unknown>) {
                Object.assign(this, init);
            }
        };
    });

    it('publishes the track once the shim knows its length, with the shim\'s source standing in for audioSrc', () => {
        const deck = Object.assign(new EventTarget(), { currentTime: 0, duration: Number.NaN, readyState: 0, currentSrc: '', playbackRate: 1 });
        const ref = (fn: unknown) => ({ current: fn });
        function Probe() {
            useMediaSessionBridge({
                audioRef: { current: deck as unknown as HTMLAudioElement },
                audioSrc: null,
                currentSong: navidromeSong,
                cachedCoverUrl: null,
                playerState: PlayerState.PLAYING,
                isNowPlayingStageActive: false,
                unknownArtistLabel: 'Unknown',
                mediaSessionPlayRef: ref(async () => undefined) as never,
                mediaSessionPauseRef: ref(() => undefined) as never,
                mediaSessionPrevRef: ref(() => undefined) as never,
                mediaSessionNextRef: ref(() => undefined) as never,
                isNowPlayingControlDisabledRef: { current: false },
            });
            return null;
        }
        render(React.createElement(Probe));
        expect(mediaSession.metadata).toBeNull();

        act(() => usePlaybackStore.setState({ playbackRoute: 'hifi' }));
        showHifiTrack('navidrome:nd-1#b');
        // No length yet: nothing to publish.
        expect(mediaSession.metadata).toBeNull();

        position = 12;
        hifiMediaShim.setDuration(200);
        expect(mediaSession.setPositionState).toHaveBeenLastCalledWith({ duration: 200, playbackRate: 1, position: 12 });
        expect(mediaSession.metadata).toMatchObject({ title: 'Remote', artist: 'Artist', album: 'Album' });
    });
});
