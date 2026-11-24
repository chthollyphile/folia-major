// sources/ytm/main/ytmApiBridge.d.cts
// The types of ytmApiBridge.cjs, for main/index.ts (sources/ compiles without allowJs).

/** Where the sign-in is kept: the main process's store (api.legacy.store). */
export interface YtmStore {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
    delete(key: string): void;
}

/** The part of Electron's safeStorage the session repository uses. */
export interface YtmSafeStorage {
    isEncryptionAvailable(): boolean;
    getSelectedStorageBackend?(): string;
    encryptString(text: string): Buffer;
    decryptString(sealed: Buffer): string;
}

/** A read of the `_media/audio` route, taken apart (audio.cjs's `serve`). */
export interface YtmAudioRead {
    videoId: string;
    level: string;
    key: string;
    method?: string;
    range?: string | null;
}

export interface YtmApiBridge {
    /** One operation of the client (`{ ok, data }` or `{ ok: false, error }`). */
    request(operation: string, params?: Record<string, unknown>): Promise<unknown>;
    /** Answers a read of a track's address. */
    serveAudio(read: YtmAudioRead): Promise<Response>;
    /** The app quits or the mod stops: null with nothing to wait for, else a promise settled in 3 seconds at most. */
    shutdown(): Promise<unknown> | null;
}

export function createYtmApiBridge(options: {
    store: YtmStore;
    safeStorage: YtmSafeStorage;
    fetch: (input: string | URL | Request, init?: Record<string, unknown>) => Promise<Response>;
    evaluate: (code: string) => Promise<unknown>;
    language?: () => string;
    signInFolder?: () => string | undefined;
    audioUrl?: (videoId: string, level: string, key: string) => string;
    /** Told of the work a quit is to wait for as it begins: a web sign-in's browser to end and folder to remove. */
    onSignInWork?: (done: Promise<unknown>) => void;
}): YtmApiBridge;
