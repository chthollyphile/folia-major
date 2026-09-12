// src/types/remotePlayback.ts

import type { AudioQualityPreference } from './onlineMusic';

export type RemotePlaybackCommand = 'play' | 'pause' | 'seek' | 'volume';
export interface RemotePlaybackSnapshot {
    mediaId: string | null;
    catalogMediaId?: string | null;
    position: number;
    duration: number;
    playing: boolean;
}
export interface RemotePlaybackStartOptions {
    quality?: AudioQualityPreference;
    /** The backend already advanced to this item from its own queue; keep it playing instead of reloading. */
    continueIfCurrent?: boolean;
}
export interface RemotePlaybackBackend {
    start(mediaId: string, options?: RemotePlaybackStartOptions): Promise<void>;
    command(command: RemotePlaybackCommand, value?: number): Promise<void>;
    snapshot(): Promise<RemotePlaybackSnapshot>;
    /** Lines the item up after the current one so the backend hands over without a gap. */
    queueNext?(mediaId: string): Promise<void>;
}
