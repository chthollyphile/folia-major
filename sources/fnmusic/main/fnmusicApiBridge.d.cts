// sources/fnmusic/main/fnmusicApiBridge.d.cts
// The types of fnmusicApiBridge.cjs, for main/index.ts (sources/ compiles without allowJs).

export type FnMusicBridgeResult =
    | { ok: true; status?: number; data: unknown }
    | { ok: false; status?: number; error?: { code?: string | number; message?: string; errno?: string | null } };

export interface FnMusicBridgeStatus {
    available: boolean;
    configured: boolean;
    authenticated: boolean;
    base: string | null;
    username: string | null;
    userId: string | null;
    nickname: string | null;
}

/** One read of a media route, as api.media.serve hands it (only what the bridge reads). */
export interface FnMusicMediaRead {
    query: Readonly<Record<string, string>>;
    range?: string | null;
}

export interface FnMusicStore {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
    delete?(key: string): void;
}

export interface FnMusicSafeStorage {
    isEncryptionAvailable(): boolean;
    encryptString(text: string): Buffer;
    decryptString(sealed: Buffer): string;
    getSelectedStorageBackend?(): string;
}

export interface FnMusicApiBridge {
    serveStream(read: FnMusicMediaRead): Promise<Response>;
    serveCover(read: FnMusicMediaRead): Promise<Response>;
    getStatus(): FnMusicBridgeStatus;
    login(params: { base?: string; username?: string; password?: string; deviceId?: string }): Promise<FnMusicBridgeResult>;
    logout(): Promise<FnMusicBridgeResult>;
    request(params: { path: string; method?: 'GET' | 'POST'; params?: Record<string, unknown>; body?: unknown }): Promise<FnMusicBridgeResult>;
    stream(params: { trackId: string }): Promise<FnMusicBridgeResult>;
    coverUrl(params: { coverId: string; size?: number }): Promise<FnMusicBridgeResult>;
}

export function createFnmusicApiBridge(deps: {
    store: FnMusicStore;
    safeStorage: FnMusicSafeStorage;
    mediaUrl: (name: 'stream' | 'cover') => string;
}): FnMusicApiBridge;

export function performRequest(options: Record<string, unknown>): Promise<FnMusicBridgeResult>;
export function resolveServerCandidates(input: unknown): string[];
export function normalizeBase(value: unknown): string | null;
export function buildAuthCookie(options: { token?: string | null; relay?: boolean }): string | null;
