import { useEffect, useRef } from 'react';
import type { SongResult } from '@/types';
import { PlayerState } from '@/types';
import {
    usePlaybackStore,
    selectDisplayDuration,
    selectDisplayPlayerState,
    selectDisplaySong,
} from '@/stores/usePlaybackStore';
import { useAppViewStore } from '@/stores/useAppViewStore';
import { setStatusMessage } from '@/stores/useStatusMessageStore';
import { currentTime } from '@/stores/motionSignals';
import type { PanelTab } from '@/components/UnifiedPanel';
import { resolveFoliumSongRef, toFoliumSong } from './dto';
import { registerFoliumHostActions } from './services';

// src/mods/folium/hostActions.ts
// App registers the real host actions behind folium.playback / folium.ui here.
// Handlers are read through a ref, so the registration happens once and always
// calls App's latest callbacks without re-registering on every render.

export interface FoliumAppActions {
    play: () => void;
    pause: () => void;
    toggle: () => void;
    seek: (seconds: number) => void;
    next: () => void;
    previous: () => void;
    playSong: (song: SongResult) => void | Promise<void>;
    enqueue: (song: SongResult) => void;
    navigateToPlayer: () => void;
    navigateToHome: () => void;
}

export const useFoliumHostActions = (actions: FoliumAppActions) => {
    const actionsRef = useRef(actions);
    actionsRef.current = actions;

    useEffect(() => {
        registerFoliumHostActions({
            getPlaybackState: () => {
                const state = usePlaybackStore.getState();
                const playerState = selectDisplayPlayerState(state);
                const duration = selectDisplayDuration(state);
                return {
                    song: toFoliumSong(selectDisplaySong(state)),
                    state: playerState === PlayerState.PLAYING ? 'playing' : playerState === PlayerState.PAUSED ? 'paused' : 'stopped',
                    position: currentTime.get(),
                    duration: Number.isFinite(duration) ? duration : 0,
                };
            },
            play: () => actionsRef.current.play(),
            pause: () => actionsRef.current.pause(),
            toggle: () => actionsRef.current.toggle(),
            seek: (seconds) => actionsRef.current.seek(seconds),
            next: () => actionsRef.current.next(),
            previous: () => actionsRef.current.previous(),
            playSongRef: async (ref) => {
                const song = resolveFoliumSongRef(ref);
                if (!song) return false;
                await actionsRef.current.playSong(song);
                return true;
            },
            enqueueSongRef: (ref) => {
                const song = resolveFoliumSongRef(ref);
                if (!song) return false;
                actionsRef.current.enqueue(song);
                return true;
            },
            toast: (message, type, durationMs) => setStatusMessage({ type, text: message, ...(durationMs ? { durationMs } : {}) }),
            openPlayerPanel: (tab) => {
                const view = useAppViewStore.getState();
                if (tab) view.setPanelTab(tab as PanelTab);
                view.setIsPanelOpen(true);
            },
            navigate: (target) => (target === 'player' ? actionsRef.current.navigateToPlayer() : actionsRef.current.navigateToHome()),
        });
        return () => registerFoliumHostActions(null);
    }, []);
};
