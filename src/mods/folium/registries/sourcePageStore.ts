import type { FoliumSourcePageStore } from '../sources/contract';
import { listStoredKeysStartingWith, readStoredString, removeStoredKey, setStoredString } from '@/stores/storagePrimitives';

// src/mods/folium/registries/sourcePageStore.ts
// `folium.sources.pageStore(sourceId)` (plan §4.6): a source's synchronous store of short strings in the window, on
// localStorage under `online_provider:<source id>:<key>`, the key providerStorage.getProviderSessionKey makes, so a
// built-in source that moves to a mod keeps what it kept there. Main window only (the client loader hands it in).

/** The page store's keys: `online_provider:<source id>:<key>`. */
export const foliumPageStoreKey = (sourceId: string, key: string) => `online_provider:${sourceId}:${key}`;

const PAGE_STORE_KEY = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

/** The synchronous store of source `sourceId`. */
export const createFoliumPageStore = (sourceId: string): FoliumSourcePageStore => {
    const prefix = foliumPageStoreKey(sourceId, '');
    const checked = (key: unknown): string => {
        if (typeof key !== 'string' || !PAGE_STORE_KEY.test(key)) {
            throw new TypeError('pageStore: a key is 1 to 128 letters, digits, _, . and -');
        }
        return prefix + key;
    };
    return Object.freeze({
        get: (key: string) => readStoredString(checked(key)),
        set: (key: string, value: string | null) => {
            const at = checked(key);
            const given: unknown = value;
            if (given !== null && typeof given !== 'string') throw new TypeError('pageStore.set: a value is a string, or null to remove it');
            try {
                if (given === null) removeStoredKey(at);
                else setStoredString(at, given);
            } catch (error) {
                console.warn(`[Folium] pageStore ${sourceId}: could not write ${key}`, error);
            }
        },
        keys: () => listStoredKeysStartingWith([prefix]).map((name) => name.slice(prefix.length)),
    });
};
