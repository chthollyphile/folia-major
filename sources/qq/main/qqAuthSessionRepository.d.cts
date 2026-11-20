// sources/qq/main/qqAuthSessionRepository.d.cts
// The types of qqAuthSessionRepository.cjs, for main/index.ts (sources/ compiles without allowJs).

/** Electron's safeStorage, as far as the repository reads it (main/index.ts hands api.seal in this shape). */
export interface QqSafeStorage {
    isEncryptionAvailable(): boolean;
    encryptString(text: string): Buffer;
    decryptString(sealed: Buffer): string;
    getSelectedStorageBackend?(): string;
}

/** The store the sessions are kept in (api.legacy.store). */
export interface QqStore {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
    delete?(key: string): void;
}

/** What qq-music-api's configureAuthSessionRepository takes. */
export interface QqAuthSessionRepository {
    kind: string;
    load(): unknown[];
    save(sessions: unknown[]): void;
    loadFailed(): boolean;
}

export function createQqAuthSessionRepository(options: {
    store: QqStore;
    safeStorage: QqSafeStorage;
    platform?: string;
    now?: () => number;
    logger?: Pick<Console, 'info' | 'warn'>;
}): QqAuthSessionRepository;
