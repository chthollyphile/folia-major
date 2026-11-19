// sources/qishui/main/session.d.cts
// The types of session.cjs, for main/index.ts (sources/ compiles without allowJs).

/** Where the session and the device id are kept: the main process's store (api.legacy.store). */
export interface QishuiStore {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
    delete(key: string): void;
}

/** The part of Electron's safeStorage the repository uses. */
export interface QishuiSafeStorage {
    isEncryptionAvailable(): boolean;
    getSelectedStorageBackend?(): string;
    encryptString(text: string): Buffer;
    decryptString(sealed: Buffer): string;
}

export const SESSION_KEY: 'QISHUI_SESSION_V1';
export const DEVICE_KEY: 'QISHUI_DEVICE_ID';
export function isAccountId(value: unknown): boolean;
