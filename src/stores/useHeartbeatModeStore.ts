import { create } from 'zustand';
import type { HeartbeatRequestOptions, MediaId, OnlineProviderId } from '../types/onlineMusic';
import type { SongResult } from '../types';

// src/stores/useHeartbeatModeStore.ts
// A live recommendation session, deliberately not persisted or shared with Personal FM.

export interface HeartbeatSession extends HeartbeatRequestOptions {
    id: number;
    providerId: OnlineProviderId;
    userId: MediaId;
}

export interface HeartbeatQueueSnapshot {
    queue: SongResult[];
    currentSong: SongResult | null;
}

export interface HeartbeatQueueReturn {
    songKey: string;
    queue: SongResult[];
    originalQueue: SongResult[];
    originalCurrentSong: SongResult | null;
}

interface HeartbeatModeState {
    session: HeartbeatSession | null;
    loading: boolean;
    generation: number;
    originalPlayback: HeartbeatQueueSnapshot | null;
    pendingReturn: HeartbeatQueueReturn | null;
    begin: () => number;
    stop: () => void;
}

export const useHeartbeatModeStore = create<HeartbeatModeState>((set, get) => ({
    session: null,
    loading: false,
    generation: 0,
    originalPlayback: null,
    pendingReturn: null,
    begin: () => {
        const generation = get().generation + 1;
        set({ session: null, loading: true, generation, originalPlayback: null, pendingReturn: null });
        return generation;
    },
    stop: () => set(state => ({ session: null, loading: false, generation: state.generation + 1, originalPlayback: null, pendingReturn: null })),
}));

/** Finish a departing Heartbeat track once, even when the saved ordinary mode repeats one song. */
export const selectHeartbeatSequentialPlayback = (state: HeartbeatModeState): boolean => Boolean(state.session || state.pendingReturn);
