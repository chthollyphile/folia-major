import { afterEach, expect, it, vi } from 'vitest';
import { PlayerState, type SongResult } from '../../../src/types';
import { usePlaybackStore } from '../../../src/stores/usePlaybackStore';
import { readRemoteActionsSource } from '../../../src/hooks/useRemoteControlActions';
import { registerRemoteActions } from '../../../src/mods/folium/registries/remoteActions';
import { createRemoteControlActionBridge } from '../../../src/services/remoteControlActions';
import { createRemoteActionActivation } from '../../../src/utils/remoteActionActivation';
import { getPlaybackSongKey } from '../../../src/utils/appPlaybackGuards';
import { buildPlaybackSyncBridgeModel, buildRemoteControlSnapshotFromPlaybackSyncBridge } from '../../../src/utils/playbackSyncBridge';

// test/unit/remote/remoteActionsSource.test.ts
// A stage may expose metadata while native remote transport has no controllable track.
const initialPlayback = usePlaybackStore.getState();
afterEach(() => usePlaybackStore.setState(initialPlayback, true));

it('scopes stage actions to the displayed song independently of native transport availability', async () => {
    const song: SongResult = {
        id: 42, name: 'Stage song', artists: [{ id: 1, name: 'Artist' }],
        album: { id: 1, name: 'Album', coverUrl: '' }, durationMs: 180_000,
    };
    usePlaybackStore.setState({ currentSong: song, playerState: PlayerState.PLAYING, transitionDisplay: null });
    const stop = vi.fn();
    const vote = vi.fn();
    const handle = registerRemoteActions('stage-test', { id: 'actions', actions: () => [
        { id: 'stop', label: { en: 'Stop session' }, icon: 'square', scope: 'session', run: stop },
        { id: 'vote', label: { en: 'Vote' }, icon: 'thumbs-up', run: vote },
    ] });
    const bridge = createRemoteControlActionBridge(readRemoteActionsSource);
    try {
        const native = buildRemoteControlSnapshotFromPlaybackSyncBridge(buildPlaybackSyncBridgeModel({
            activePlaybackContext: 'stage', currentSong: song, playQueue: [], currentTimeSec: 0,
            durationSec: 180, playerState: PlayerState.PLAYING, coverUrl: null, effectiveLoopMode: 'off',
            isFmMode: false, isStageActive: true, controlsDisabled: true,
            transparentModeEnabled: false, mainWindowClickThroughEnabled: false,
            mainWindowBorderVisible: true, playerChromeHidden: false,
            exportState: { status: 'idle', presetId: null, progress: 0, elapsed: 0, duration: 0, countdown: null, filePath: null, error: null },
            isDaylight: false, isLiked: false, mainWindowWidth: 1280, mainWindowHeight: 720,
        }), { playerChromeVisibilityMode: 'auto-hide', subtitleContentMode: 'translation' });
        const snapshot = bridge.read()!;
        expect(native.trackKey).toBeNull();
        expect(snapshot.trackKey).toBe(getPlaybackSongKey(song));
        expect(snapshot.items.map(item => item.disabled)).toEqual([false, false]);
        expect(await bridge.activate(createRemoteActionActivation(snapshot, snapshot.items[0]))).toBe(true);
        expect(await bridge.activate(createRemoteActionActivation(snapshot, snapshot.items[1]))).toBe(true);
        expect(stop).toHaveBeenCalledOnce();
        expect(vote).toHaveBeenCalledOnce();
        expect(readRemoteActionsSource().context.song?.title).toBe('Stage song');
        usePlaybackStore.setState({ currentSong: { ...song, id: 43, name: 'Next stage song' } });
        expect(await bridge.activate(createRemoteActionActivation(snapshot, snapshot.items[1]))).toBe(false);
        expect(await bridge.activate(createRemoteActionActivation(snapshot, snapshot.items[0]))).toBe(true);
        expect(vote).toHaveBeenCalledOnce();
        expect(stop).toHaveBeenCalledTimes(2);
    } finally {
        bridge.dispose();
        handle.unregister();
    }
});
