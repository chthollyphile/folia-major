// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import { PlayerState } from '@/types';

// test/unit/playback/playbackInteractionHifi.test.ts
// The play/pause toggle, Space and the arrow keys on the HiFi route: the deck there is silent with no
// source, so the toggle asks mpv's state and an arrow key seeks mpv - leaving a paused song paused, as
// it always has on a deck - instead of writing the deck or the blend's seek port.

vi.hoisted(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key), clear: () => values.clear(),
    } });
});

const { usePlaybackInteractionBridge } = await import('@/components/app/playback/bridges/usePlaybackInteractionBridge');
const { hifiTransport } = await import('@/services/hifi/hifiPlayback');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { useAppViewStore } = await import('@/stores/useAppViewStore');
const { currentTime } = await import('@/stores/motionSignals');

const song = { id: 'song-1', name: 'Song', isLocal: true, localRef: { songId: 'song-1' }, sourceRef: { kind: 'local', mediaId: 'song-1' } } as unknown as SongResult;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;

const mount = () => {
    const deck = { paused: true, ended: false, currentTime: 0 };
    const params: Parameters<typeof usePlaybackInteractionBridge>[0] = {
        stageActiveEntryKind: null,
        isNowPlayingStageActive: false,
        audioRef: { current: deck as unknown as HTMLAudioElement },
        isTransitionAudible: () => false,
        seekDuringTransition: vi.fn(() => false),
        stageLyricsClockRef: { current: { startTimeSec: 0, endTimeSec: 0, baseTimeSec: 0, startedAtMs: null } },
        cyclePlayerChromeVisibilityMode: vi.fn(),
        handleNextTrack: vi.fn(),
        handlePrevTrack: vi.fn(),
        navigateBackFromPlayer: vi.fn(),
        pausePlayback: vi.fn(),
        resumePlayback: vi.fn(async () => undefined),
        syncStageLyricsClock: vi.fn(),
    };
    let actions!: ReturnType<typeof usePlaybackInteractionBridge>;
    function Probe() {
        actions = usePlaybackInteractionBridge(params);
        return null;
    }
    root = createRoot(document.createElement('div'));
    act(() => root!.render(React.createElement(Probe)));
    return { deck, params, actions: () => actions };
};

const press = (code: string) => act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code === 'Space' ? ' ' : code, bubbles: true }));
});

beforeEach(() => {
    usePlaybackStore.setState({
        activePlaybackContext: 'main', audioSrc: null, playbackRoute: 'hifi', currentSong: song,
        playerState: PlayerState.PLAYING, duration: 200,
    });
    useAppViewStore.setState({ view: 'player', isPanelOpen: false });
    currentTime.set(30);
});

afterEach(() => {
    act(() => root?.unmount());
    root = null;
    usePlaybackStore.setState({ playbackRoute: 'web' });
    vi.restoreAllMocks();
});

describe('playback interaction on the HiFi route', () => {
    it('toggles by mpv\'s state, not the silent deck\'s', () => {
        const host = mount();
        const isPaused = vi.spyOn(hifiTransport, 'isPaused').mockReturnValue(false);
        act(() => host.actions().togglePlay());
        expect(host.params.pausePlayback).toHaveBeenCalledTimes(1);
        expect(host.params.resumePlayback).not.toHaveBeenCalled();

        isPaused.mockReturnValue(true);
        act(() => host.actions().togglePlay());
        expect(host.params.resumePlayback).toHaveBeenCalledTimes(1);
    });

    it('takes Space with no Web source, because mpv has the song', () => {
        const host = mount();
        vi.spyOn(hifiTransport, 'isPaused').mockReturnValue(true);
        press('Space');
        expect(host.params.resumePlayback).toHaveBeenCalledTimes(1);
    });

    it('seeks mpv with the arrow keys and leaves a paused song paused', () => {
        const host = mount();
        const seek = vi.spyOn(hifiTransport, 'seek').mockResolvedValue(undefined);
        const resume = vi.spyOn(hifiTransport, 'resume').mockResolvedValue(undefined);
        vi.spyOn(hifiTransport, 'isPaused').mockReturnValue(true);
        press('ArrowRight');
        expect(seek).toHaveBeenLastCalledWith(35);
        press('ArrowLeft');
        expect(seek).toHaveBeenLastCalledWith(30);
        expect(host.params.seekDuringTransition).not.toHaveBeenCalled();
        expect(host.deck.currentTime).toBe(0);
        expect(resume).not.toHaveBeenCalled();
        expect(host.params.resumePlayback).not.toHaveBeenCalled();
    });

    it('keeps the deck paths on the Web route', () => {
        usePlaybackStore.setState({ playbackRoute: 'web', audioSrc: 'blob:song' });
        const host = mount();
        const seek = vi.spyOn(hifiTransport, 'seek');
        press('ArrowRight');
        expect(seek).not.toHaveBeenCalled();
        expect(host.params.seekDuringTransition).toHaveBeenCalledWith(35);
        expect(host.deck.currentTime).toBe(35);
        act(() => host.actions().togglePlay());
        expect(host.params.resumePlayback).toHaveBeenCalledTimes(1);
    });
});
