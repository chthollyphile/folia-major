// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.hoisted(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key), clear: () => values.clear(),
    } });
});
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useElectronPlaybackBridge } from '@/hooks/useElectronPlaybackBridge';
import { acquireExternalPlayback, releaseAllExternalPlayback, setExternalPlaybackCapabilities } from '@/services/externalPlaybackSession';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { PlayerState } from '@/types';
import type { RemoteControlCommand } from '@/types/remoteControl';
import { idleVideoExportState } from '@/types/videoExport';

// test/unit/remote/remotePlaybackSessionRouting.test.ts
// Exercise real main-window IPC listeners with an owned session but no current source.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const initial = usePlaybackStore.getState();
const ref = <T>(current: T) => ({ current });
let root: Root | undefined;
let remote: (command: RemoteControlCommand) => void;
let taskbar: (action: 'previous' | 'next' | 'toggle-play') => void;
let stage: (request: { requestId: string; action: 'prev' | 'next' }) => void;
const nativePrevious = vi.fn(), nativeNext = vi.fn(), complete = vi.fn();
beforeEach(() => {
    vi.clearAllMocks();
    usePlaybackStore.setState(initial, true);
    window.electron = {
        onRemoteControlCommand: (listener: typeof remote) => { remote = listener; return () => {}; },
        onTaskbarControl: (listener: typeof taskbar) => { taskbar = listener; return () => {}; },
        onStagePlayerControlRequest: (listener: typeof stage) => { stage = listener; return () => {}; },
        completeStagePlayerControlRequest: complete,
    } as unknown as NonNullable<typeof window.electron>;
    const box = document.createElement('div'); document.body.append(box); root = createRoot(box);
    act(() => root!.render(React.createElement(() => {
        useElectronPlaybackBridge({
            isElectronWindow: true, playerChromeVisibilityMode: 'auto-hide', isStagePlayerSnapshotEnabled: false,
            isNowPlayingControlDisabledRef: ref(false), audioRef: ref(null), effectiveLoopMode: 'off',
            isNowPlayingStageActive: false, mediaSessionPlayRef: ref(async () => {}), mediaSessionPauseRef: ref(vi.fn()),
            mediaSessionPrevRef: ref(nativePrevious), mediaSessionNextRef: ref(nativeNext),
            taskbarHasTrackRef: ref(false), taskbarPlayerStateRef: ref(PlayerState.IDLE),
            exportState: idleVideoExportState(), publishTrackTransition: false, isTrackTransitionAudible: () => false,
            isLiked: false,
        });
        return null;
    })));
});
afterEach(() => {
    act(() => { root?.unmount(); releaseAllExternalPlayback(); });
    document.body.replaceChildren(); delete window.electron;
});
it('routes remote, taskbar and Stage previous/next without a loaded source', () => {
    const dispatch = vi.fn();
    act(() => { acquireExternalPlayback({ modId: 'room', dispatch, cleanup: vi.fn(), report: vi.fn() }); });
    act(() => {
        remote({ type: 'next' }); remote({ type: 'previous' });
        taskbar('next'); taskbar('previous');
        stage({ requestId: 'next', action: 'next' }); stage({ requestId: 'prev', action: 'prev' });
    });
    expect(dispatch.mock.calls.map(([intent]) => intent.type)).toEqual(['next', 'previous', 'next', 'previous', 'next', 'previous']);
    expect(complete).toHaveBeenCalledWith({ requestId: 'next', ok: true, error: null });
    expect(nativeNext).not.toHaveBeenCalled(); expect(nativePrevious).not.toHaveBeenCalled();
});
it('consumes disabled navigation and keeps ordinary empty-player controls inert after release', () => {
    const dispatch = vi.fn();
    act(() => {
        const token = acquireExternalPlayback({ modId: 'room', dispatch, cleanup: vi.fn(), report: vi.fn() });
        setExternalPlaybackCapabilities(token, { canNext: false, canPrevious: false, canSeek: false });
        remote({ type: 'next' }); taskbar('previous'); stage({ requestId: 'disabled', action: 'next' });
        releaseAllExternalPlayback();
        remote({ type: 'next' }); taskbar('previous');
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(nativeNext).not.toHaveBeenCalled(); expect(nativePrevious).not.toHaveBeenCalled();
});
