import type { FoliumI18nService, FoliumTextKey } from './contract';

// src/mods/folium/sources/i18n.ts
// Folium 2: `folium.i18n`, the keys of a mod's own locale files as FoliumText (plan §4.6). It only makes the
// key; registries/sourceText.ts turns one into the host's i18n key, and the client loader loads the files.

/** Folium 2: `folium.i18n` for one mod. */
export const createFoliumI18n = (): FoliumI18nService => Object.freeze({
    key: (key: string, params?: Record<string, string | number>): FoliumTextKey => {
        // Read as a mod may hand them, whatever the types say.
        const given: unknown = key;
        const values: unknown = params;
        if (typeof given !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(given)) {
            throw new TypeError('i18n.key requires a key of letters, digits, _, . and -');
        }
        if (values !== undefined && (typeof values !== 'object' || values === null || Array.isArray(values))) {
            throw new TypeError('i18n.key: params must be an object of strings and numbers');
        }
        const clean = params
            ? Object.freeze(Object.fromEntries(Object.entries(params).filter(([, value]) => typeof value === 'string' || typeof value === 'number')))
            : undefined;
        return Object.freeze({ i18nKey: key, ...(clean ? { params: clean } : {}) });
    },
});
