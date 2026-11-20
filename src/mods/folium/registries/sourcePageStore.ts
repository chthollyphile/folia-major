import type { FoliumSourcePageStore } from '../sources/contract';
import { listStoredKeysStartingWith, readStoredString, removeStoredKey, setStoredString } from '@/stores/storagePrimitives';

// src/mods/folium/registries/sourcePageStore.ts
// `folium.sources.pageStore(sourceId)` (plan §4.6): a source's synchronous store of short strings in the window, on
// localStorage under `online_provider:<source id>:<key>`, the key providerStorage.getProviderSessionKey makes, so a
// built-in source that moves to a mod keeps what it kept there. Main window only (the client loader hands it in).

/** The page store's keys: `online_provider:<source id>:<key>`. */
export const foliumPageStoreKey = (sourceId: string, key: string) => `online_provider:${sourceId}:${key}`;

const PAGE_STORE_KEY = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

// What a built-in source kept in localStorage under a name of its own before it became a source mod, and the page
// store key it reads that under now: moved over once, when the store is made, where the new key is still empty
// (D507: a published key is not dropped without its move). Only the host can reach the old name.
// YouTube Music's note of whether the account has Premium (Folium 2.0, 2026-11-20).
const OLD_YTM_ACCOUNT_KEY = 'folia_ytm_account';
// NetEase's sign-in cookie and anonymous cookie, from the builds before they were kept under the provider's prefix (the
// host's provider read these names as their legacy keys up to Folium 2.0, 2026-11-20).
const OLD_NETEASE_COOKIE_KEY = 'netease_cookie';
const OLD_NETEASE_ANONYMOUS_COOKIE_KEY = 'netease_anonymous_cookie';

interface MovedPageKey { key: string; read: () => string | null; remove: () => void }

// Each old name read and removed by its own constant: D507 (dev/dedicatus/storageKeys.mjs) finds a key's uses that way.
const MOVED_PAGE_KEYS: Readonly<Record<string, readonly MovedPageKey[]>> = Object.freeze({
    ytm: [{ key: 'account', read: () => readStoredString(OLD_YTM_ACCOUNT_KEY), remove: () => { removeStoredKey(OLD_YTM_ACCOUNT_KEY); } }],
    netease: [
        { key: 'cookie', read: () => readStoredString(OLD_NETEASE_COOKIE_KEY), remove: () => { removeStoredKey(OLD_NETEASE_COOKIE_KEY); } },
        { key: 'anonymous_cookie', read: () => readStoredString(OLD_NETEASE_ANONYMOUS_COOKIE_KEY), remove: () => { removeStoredKey(OLD_NETEASE_ANONYMOUS_COOKIE_KEY); } },
    ],
});

const moveOldKeys = (sourceId: string) => {
    const moved = Object.hasOwn(MOVED_PAGE_KEYS, sourceId) ? MOVED_PAGE_KEYS[sourceId] : [];
    for (const { key, read, remove } of moved) {
        const old = read();
        if (old === null) continue;
        try {
            const at = foliumPageStoreKey(sourceId, key);
            if (readStoredString(at) === null) setStoredString(at, old);
            remove();
        } catch (error) {
            console.warn(`[Folium] pageStore ${sourceId}: could not move what it kept before under ${key}`, error);
        }
    }
};

/**
 * The old names of source `sourceId` removed without moving them ("clear data"): a profile that never made the store
 * since its upgrade still has them, and the next store made would move a cleared sign-in back.
 */
export const forgetOldPageKeys = (sourceId: string): number => {
    const moved = Object.hasOwn(MOVED_PAGE_KEYS, sourceId) ? MOVED_PAGE_KEYS[sourceId] : [];
    let removed = 0;
    for (const { read, remove } of moved) {
        try {
            if (read() === null) continue;
            remove();
            removed += 1;
        } catch (error) {
            console.warn(`[Folium] pageStore ${sourceId}: could not remove a key it kept before`, error);
        }
    }
    return removed;
};

/** The synchronous store of source `sourceId`. */
export const createFoliumPageStore = (sourceId: string): FoliumSourcePageStore => {
    const prefix = foliumPageStoreKey(sourceId, '');
    const checked = (key: unknown): string => {
        if (typeof key !== 'string' || !PAGE_STORE_KEY.test(key)) {
            throw new TypeError('pageStore: a key is 1 to 128 letters, digits, _, . and -');
        }
        return prefix + key;
    };
    moveOldKeys(sourceId);
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
