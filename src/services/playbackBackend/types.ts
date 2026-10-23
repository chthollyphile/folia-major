// Engine-independent playback contract; the host never imports a concrete audio engine.

export interface PlaybackBackendSource {
    /** Unique to this load; every asynchronous event must carry it back. */
    sourceId: string;
    url?: string;
    /** A host-created temporary copy, not a path supplied by an online provider. */
    filePath?: string;
}

export interface PlaybackBackendStatus {
    sourceId: string;
    state: 'loading' | 'playing' | 'paused' | 'stopped';
    position: number;
    duration: number;
    /** Requested and actual output are deliberately separate. */
    output?: {
        exclusiveRequested: boolean;
        exclusiveActive: boolean | null;
        sampleRate?: number;
        format?: string;
        dspActive?: boolean;
    };
}

export type PlaybackBackendEvent =
    | { type: 'status'; status: PlaybackBackendStatus }
    | { type: 'ended'; sourceId: string }
    | { type: 'error'; sourceId: string; message: string };

export interface PlaybackBackendSession {
    open(source: PlaybackBackendSource): Promise<void>;
    play(): Promise<void>;
    pause(): Promise<void>;
    seek(seconds: number): Promise<void>;
    setVolume(volume: number): Promise<void>;
    dispose(): void | Promise<void>;
}

export interface PlaybackBackendDefinition {
    name: string;
    capabilities: { seek: boolean; volume: boolean; http: boolean };
    create(report: (event: PlaybackBackendEvent) => void): PlaybackBackendSession;
}
