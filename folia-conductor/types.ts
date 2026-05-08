import type { StageRealtimeState } from '../src/types';

// Shared conductor types keep the minimal controller page readable without pulling DOM state through one file.

export type ConductorSocketStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ConductorInstance {
    id: string;
    baseUrl: string;
    token: string;
    controllerId: string;
    selected: boolean;
    socket: WebSocket | null;
    socketStatus: ConductorSocketStatus;
    playerId: string | null;
    lastEvent: string;
    lastMessageType: string | null;
    lastResponse: string;
    lastRealtimeState: StageRealtimeState | null;
}

export interface ConductorTrack {
    id: string;
    title: string;
    artist: string;
    album: string;
    coverUrl: string | null;
    audioFile: File | null;
    audioUrl: string | null;
    lyricsText: string | null;
    lyricsFormat: 'lrc' | 'enhanced-lrc' | 'vtt' | 'yrc' | null;
    durationMs: number | null;
    foliaSessionId: string | null;
    foliaDurationMs: number | null;
}

export interface ConductorEvent {
    id: string;
    title: string;
    body: string;
    at: number;
}
