// sources/spotify/main/spotifyApiBridge.d.cts
// The types of spotifyApiBridge.cjs, for main/index.ts (sources/ compiles without allowJs).

/** Where the sign-in, the way Spotify plays, Soloist's setup and the device id are kept (api.legacy.store). */
export interface SpotifyStore {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
    delete(key: string): void;
}

/** The part of Electron's safeStorage the session repository and Soloist use. */
export interface SpotifySafeStorage {
    isEncryptionAvailable(): boolean;
    getSelectedStorageBackend?(): string;
    encryptString(text: string): Buffer;
    decryptString(sealed: Buffer): string;
}

/** A read of the `_media/audio` route, taken apart (audio.cjs's `serve`). */
export interface SpotifyAudioRead {
    trackId: string;
    key: string;
    method?: string;
    range?: string | null;
}

/** One audio file kept on disk (audioFiles.cjs `list`). */
export interface SpotifyKeptFile {
    name: string;
    size: number;
    usedAt: number;
}

/** The audio files kept on disk, for the host's media cache budget. */
export interface SpotifyAudioFiles {
    list(): Promise<SpotifyKeptFile[]>;
    remove(name: string): Promise<void>;
    clear(): Promise<void>;
}

export interface SpotifyApiBridge {
    /** One operation of the client (`{ ok, data }` or `{ ok: false, error }`). */
    request(operation: string, params?: Record<string, unknown>): Promise<unknown>;
    /** Answers a read of a track's address. */
    serveAudio(read: SpotifyAudioRead): Promise<Response>;
    /** The audio files kept on disk; null without a folder for them. */
    audioFiles: SpotifyAudioFiles | null;
    /** Pauses Soloist where it runs. */
    pauseSoloist(): Promise<unknown>;
    /** Stops Soloist and waits for a token renewal under way: null with nothing to do, else a promise settled in 3 seconds at most. */
    shutdown(): Promise<unknown> | null;
    /** Closes the sign-in's local port and the playback component's connection (after `shutdown`, when the source is turned off). */
    dispose(): void;
}

export function createSpotifyApiBridge(options: {
    store: SpotifyStore;
    safeStorage: SpotifySafeStorage;
    fetch: (input: string | URL, init?: Record<string, unknown>) => Promise<Response>;
    openExternal: (url: string) => Promise<unknown>;
    language?: () => string;
    loadLibrespot?: () => unknown;
    audioUrl?: (trackId: string, key: string) => string;
    /** Told of a token renewal under way, with a promise settled when it is over. */
    onRenewing?: (done: Promise<void>) => void;
    audioDirectory?: () => string;
    onAudioKept?: (limitBytes?: number) => unknown;
    soloistPaths?: { data(): string; cache(): string };
    chooseSoloistFile?: () => Promise<string | null>;
    /** Told when Soloist begins or stops running, being started or being followed. */
    onSoloistActive?: (active: boolean) => void;
    /** Registers what stops Soloist when the process ends without quitting. */
    onProcessExit?: (stop: () => void) => void;
}): SpotifyApiBridge;
