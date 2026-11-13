import i18n from '@/i18n/config';
import type { ModRuntimeInfo } from '../types';
import { foliumModTextNamespace } from '../folium/registries/sourceText';

// src/mods/runtime/modLocales.ts
// Folium 2.0 (plan §4.6): a `folium: 2` mod's own locale files, the folder its manifest names as `locales`, one
// `<language>.json` per language the app has (`zh-CN.json`, `en.json`, …). Each becomes the i18n namespace
// `folium-mod/<mod id>`, where `folium.i18n.key` texts are looked up; a language without a file falls back as
// the app's own texts do. Loaded before the client starts and taken out when it stops. A file that is not
// there, or not JSON, is skipped (said once in the developer log).

const languages = (): string[] => {
    const supported: unknown = i18n.options.supportedLngs;
    const listed = Array.isArray(supported) ? (supported as unknown[]).filter((language): language is string => typeof language === 'string') : ['en'];
    return listed.filter((language) => language !== 'cimode');
};

/** `folia-mod://<mod id>/<locales>/<language>.json`, from the client URL's origin. */
const localeFileUrl = (mod: ModRuntimeInfo, language: string): string | null => {
    const folder = (mod.locales ?? '').replace(/^\.?\/+/, '').replace(/\/+$/, '');
    if (!folder || !mod.clientUrl) return null;
    const origin = /^folia-mod:\/\/[^/]+\//.exec(mod.clientUrl)?.[0];
    return origin ? `${origin}${folder}/${language}.json` : null;
};

/** Loads `mod`'s locale files into its namespace; resolves to the function that takes them out again. */
export const loadFoliumModLocales = async (mod: ModRuntimeInfo): Promise<() => void> => {
    const namespace = foliumModTextNamespace(mod.id);
    const loaded: string[] = [];
    await Promise.all(languages().map(async (language) => {
        const url = localeFileUrl(mod, language);
        if (!url) return;
        try {
            const response = await fetch(url);
            if (!response.ok) return;
            const resources: unknown = await response.json();
            if (typeof resources !== 'object' || resources === null || Array.isArray(resources)) return;
            i18n.addResourceBundle(language, namespace, resources, true, true);
            loaded.push(language);
        } catch (error) {
            console.info(`[Folium] locale file ${language}.json of ${mod.id} was not loaded`, error);
        }
    }));
    if (loaded.length > 0) console.info(`[Folium] locale files of ${mod.id} loaded: ${loaded.join(', ')}`);
    return () => loaded.forEach((language) => i18n.removeResourceBundle(language, namespace));
};
