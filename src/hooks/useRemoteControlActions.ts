import { useEffect, useMemo, useRef } from 'react';
import { PlayerState } from '../types';
import { selectDisplayPlayerState, selectDisplaySong, usePlaybackStore } from '../stores/usePlaybackStore';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';
import { toFoliumSong } from '../mods/folium/dto';
import { createRemoteControlActionBridge } from '../services/remoteControlActions';
import type { RemoteActionActivation } from '../types/remoteControl';

// src/hooks/useRemoteControlActions.ts
// Own tickets for one main-window mount and read displayed playback state at activation time.
export const readRemoteActionsSource = () => {
    const playback = usePlaybackStore.getState();
    const song = selectDisplaySong(playback);
    const state = selectDisplayPlayerState(playback);
    const publicSong = toFoliumSong(song);
    return {
        trackKey: song ? getPlaybackSongKey(song) : null,
        context: Object.freeze({
            song: publicSong ? Object.freeze(publicSong) : null,
            state: state === PlayerState.PLAYING ? 'playing' as const
                : state === PlayerState.PAUSED ? 'paused' as const : 'stopped' as const,
        }),
    };
};

export const useRemoteControlActions = (enabled: boolean) => {
    const bridgeRef = useRef<ReturnType<typeof createRemoteControlActionBridge> | null>(null);
    useEffect(() => {
        if (!enabled) return;
        const bridge = createRemoteControlActionBridge(readRemoteActionsSource);
        bridgeRef.current = bridge;
        return () => {
            bridge.dispose();
            if (bridgeRef.current === bridge) bridgeRef.current = null;
        };
    }, [enabled]);
    return useMemo(() => ({
        read: () => bridgeRef.current?.read(),
        activate: (command: RemoteActionActivation) => bridgeRef.current?.activate(command) ?? Promise.resolve(false),
    }), []);
};
