// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { PlayerState } from '@/types';
import type { SongResult } from '@/types';
import { useMediaSessionBridge } from '@/hooks/useMediaSessionBridge';

// Exercise the loading transition through the hook and media events.
vi.mock('@/stores/usePlaybackStore', () => ({ usePlaybackStore: (select: (state: unknown) => unknown) => select({ playbackRoute: 'web' }) }));
vi.mock('@/services/hifi/hifiPlayback', () => ({ useHifiTrackStore: (select: (state: unknown) => unknown) => select({ current: null }) }));
vi.mock('@/services/hifi/hifiMediaShim', () => ({ getObservedMedia: (audio: unknown) => audio, hifiMediaShim: {} }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('shows Folia until the selected source has a timeline, then publishes the track', () => {
    const audio = document.createElement('audio');
    let source = 'https://example.com/old.mp3';
    let ready = 1;
    let duration = 120;
    Object.defineProperties(audio, {
        currentSrc: { get: () => source },
        readyState: { get: () => ready },
        duration: { get: () => duration },
    });
    const session = { metadata: null as MediaMetadata | null, setPositionState: vi.fn(), setActionHandler: vi.fn(), playbackState: 'none' };
    vi.stubGlobal('MediaMetadata', class { constructor(init: MediaMetadataInit) { Object.assign(this, init); } });
    Object.defineProperty(navigator, 'mediaSession', { configurable: true, value: session });
    const empty = { current: vi.fn() };
    const props = {
        audioRef: { current: audio }, audioSrc: 'https://example.com/old.mp3',
        currentSong: { id: 1, name: 'Old' } as SongResult, cachedCoverUrl: null,
        playerState: PlayerState.PLAYING, isNowPlayingStageActive: false, unknownArtistLabel: 'Unknown',
        mediaSessionPlayRef: { current: async () => {} }, mediaSessionPauseRef: empty,
        mediaSessionPrevRef: empty, mediaSessionNextRef: empty,
        isNowPlayingControlDisabledRef: { current: false },
    };
    function Probe() { useMediaSessionBridge(props); return null; }
    const root = createRoot(document.createElement('div'));
    try {
        act(() => root.render(React.createElement(Probe)));
        expect(session.metadata?.title).toBe('Old');
        props.currentSong = { id: 2, name: 'New' } as SongResult;
        props.audioSrc = 'https://example.com/new.mp3';
        act(() => root.render(React.createElement(Probe)));
        expect(session.metadata?.title).toBe('Folia');
        expect(session.setPositionState).toHaveBeenLastCalledWith();
        source = props.audioSrc;
        ready = 1;
        duration = 180;
        act(() => audio.dispatchEvent(new Event('loadedmetadata')));
        expect(session.metadata?.title).toBe('New');
        expect(session.setPositionState).toHaveBeenLastCalledWith({ duration: 180, position: 0, playbackRate: 1 });
    } finally {
        act(() => root.unmount());
        vi.unstubAllGlobals();
        delete (navigator as { mediaSession?: MediaSession }).mediaSession;
    }
});
