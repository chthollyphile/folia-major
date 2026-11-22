import type { FoliumI18nService, FoliumTextKey } from './contract';

// src/mods/folium/sources/i18n.ts
// Folium 2: `folium.i18n`, the keys of a mod's own locale files as FoliumText (plan §4.6). It only makes the
// key; registries/sourceText.ts turns one into the host's i18n key, and the client loader loads the files.

const checkParams = (params: unknown, member: string): Record<string, string | number> | undefined => {
    if (params === undefined) return undefined;
    if (typeof params !== 'object' || params === null || Array.isArray(params)) {
        throw new TypeError(`i18n.${member}: params must be an object of strings and numbers`);
    }
    return Object.fromEntries(Object.entries(params).filter(([, value]) => typeof value === 'string' || typeof value === 'number'));
};

/**
 * Folium 2: `folium.i18n` for one mod. `translate` reads a key of the mod's locale files in the UI language now (the
 * client API hands the host's i18n in, api.ts); without one, `text` answers ''.
 */
export const createFoliumI18n = (
    translate: (key: string, params: Record<string, string | number> | undefined) => string = () => '',
): FoliumI18nService => Object.freeze({
    text: (key: string, params?: Record<string, string | number>): string => {
        const given: unknown = key;
        if (typeof given !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(given)) {
            throw new TypeError('i18n.text requires a key of letters, digits, _, . and -');
        }
        return translate(key, checkParams(params, 'text'));
    },
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
