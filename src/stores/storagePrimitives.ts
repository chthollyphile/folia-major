// src/stores/storagePrimitives.ts
// The localStorage read/write primitives every settings store shares.
//
// Moved out of useSettingsUiStore so the domain stores split out of it do not have to import
// from each other just to read a boolean. Behaviour is unchanged, including the SSR guard.

export const getStoredBoolean = (key: string, fallback: boolean) => {
    if (typeof window === 'undefined') {
        return fallback;
    }

    const saved = localStorage.getItem(key);
    return saved !== null ? saved === 'true' : fallback;
};

export const setStoredBoolean = (key: string, value: boolean) => {
    if (typeof window !== 'undefined') {
        localStorage.setItem(key, String(value));
    }
};

export const setStoredString = (key: string, value: string) => {
    if (typeof window !== 'undefined') {
        localStorage.setItem(key, value);
    }
};

/** The stored string, or null where there is none (or the storage cannot be read). */
export const readStoredString = (key: string): string | null => {
    if (typeof window === 'undefined') {
        return null;
    }
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
};

export const getStoredString = (key: string, fallback: string) => {
    if (typeof window === 'undefined') {
        return fallback;
    }

    return localStorage.getItem(key) || fallback;
};

/** Every stored key that starts with one of `prefixes` (Folium 2.0: a source's own keys, for its "clear data"). */
export const listStoredKeysStartingWith = (prefixes: readonly string[]): string[] => {
    if (typeof window === 'undefined') {
        return [];
    }
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key !== null && prefixes.some((prefix) => key.startsWith(prefix))) keys.push(key);
    }
    return keys;
};

export const removeStoredKey = (key: string) => {
    if (typeof window !== 'undefined') {
        localStorage.removeItem(key);
    }
};
