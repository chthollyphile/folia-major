// sources/kugou/main/kugouApiBridge.d.cts
// The types of kugouApiBridge.cjs, for main/index.ts (sources/ compiles without allowJs).

/** Electron's safeStorage, as far as the bridge reads it (main/index.ts hands api.seal in this shape). */
export interface KugouSafeStorage {
    isEncryptionAvailable(): boolean;
    encryptString(text: string): Buffer;
    decryptString(sealed: Buffer): string;
    getSelectedStorageBackend?(): string;
}

/** The store the session is kept in (api.legacy.store). */
export interface KugouStore {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
    delete?(key: string): void;
}

export interface KugouApiBridge {
    getStatus(): { available: boolean; authenticated: boolean; error: string | null };
    /** KuGouMusicApi's answer body; rejects with an Error whose message is the bridge's `KuGouApi[...]` line. */
    request(operation: string, params?: Record<string, unknown>): Promise<unknown>;
}

export const LEGACY_SESSION_KEY: 'KUGOU_API_SESSION_V1';
export const SESSION_KEY: 'KUGOU_API_SESSION_V2';
export const OPERATION_MODULES: Record<string, string[]>;

export function normalizeBridgeError(operation: string, error: unknown, unloaded?: boolean): Error;

export function createKugouApiBridge(options: {
    store: KugouStore;
    safeStorage: KugouSafeStorage;
    platform?: string;
    warn?: (...args: unknown[]) => void;
    /** The loaded KuGouMusicApi (its table of functions); throws where it could not be loaded. */
    apiLoader: () => Record<string, unknown>;
}): KugouApiBridge;
