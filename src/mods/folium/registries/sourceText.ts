import i18n from '@/i18n/config';
import type { FoliumLabel } from '../contract';
import type { FoliumText, FoliumTextKey } from '../sources/contract';
import { resolveFoliumLabel } from '../../params/params';

// src/mods/folium/registries/sourceText.ts
// The texts of a Folium 2.0 source (plan §4.6). The source hands a FoliumText (written out, one string per
// language, or a key of the mod's own locale files); the host's interface translates i18n keys, so each text
// becomes one key, and the host's interface is not changed:
//   - a key of the mod's locale files is that key in the mod's namespace (`folium-mod/<mod id>`, which the
//     client loader fills from the manifest's `locales` before the mod starts);
//   - one with `params` gets a key of its own whose text nests the mod's key with those values;
//   - a written-out text or a label gets a key of its own in the source's namespace
//     (`folium-source/<source id>`), one text per language.
// A text the source hands again (a login form read for every render) is the same key: the keys are made
// from the text itself and remembered, so asking again adds nothing. The source's namespace goes with it.

/** The i18n namespace of a mod's own locale files. `:` separates namespaces, so it cannot appear here. */
export const foliumModTextNamespace = (modId: string) => `folium-mod/${modId}`;

const isTextKey = (value: unknown): value is FoliumTextKey => (
    typeof value === 'object' && value !== null && typeof (value as FoliumTextKey).i18nKey === 'string'
);

const isLabel = (value: unknown): value is FoliumLabel => (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !isTextKey(value)
    && Object.values(value).some((entry) => typeof entry === 'string')
);

/** Whether `value` is a FoliumText. */
export const isFoliumText = (value: unknown): value is FoliumText => (
    typeof value === 'string' || isTextKey(value) || isLabel(value)
);

const languages = (): string[] => {
    const supported: unknown = i18n.options.supportedLngs;
    const listed = Array.isArray(supported) ? (supported as unknown[]).filter((language): language is string => typeof language === 'string') : ['en'];
    return listed.filter((language) => language !== 'cimode');
};

// A short stable name for a text (FNV-1a over its JSON).
const nameOf = (serialized: string): string => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < serialized.length; index += 1) {
        hash ^= serialized.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return `t${(hash >>> 0).toString(36)}`;
};

export interface FoliumSourceTextBook {
    /** The source's namespace. */
    readonly namespace: string;
    /** The i18n key of `text`; undefined for none (undefined, null, ''). Throws for a value that is no FoliumText. */
    key(text: FoliumText | null | undefined, field: string): string | undefined;
    /** `text` in the UI language now; '' for none. */
    now(text: FoliumText | null | undefined, field: string): string;
    /** Takes the source's namespace out. */
    dispose(): void;
}

/** The texts of source `sourceId` of mod `modId`. */
export const createFoliumSourceTextBook = (modId: string, sourceId: string): FoliumSourceTextBook => {
    const namespace = `folium-source/${sourceId}`;
    const modNamespace = foliumModTextNamespace(modId);
    const byString = new Map<string, string>();
    const byObject = new WeakMap<object, string>();
    const added = new Set<string>();

    const add = (serialized: string, valueIn: (language: string) => string): string => {
        const name = nameOf(serialized);
        if (!added.has(name)) {
            added.add(name);
            languages().forEach((language) => i18n.addResource(language, namespace, name, valueIn(language)));
        }
        return `${namespace}:${name}`;
    };

    const key = (text: FoliumText | null | undefined, field: string): string | undefined => {
        if (text === undefined || text === null || text === '') return undefined;
        if (typeof text === 'string') {
            const known = byString.get(text);
            if (known) return known;
            const made = add(JSON.stringify(text), () => text);
            byString.set(text, made);
            return made;
        }
        if (typeof text !== 'object') throw new TypeError(`${field} must be a string, a { language: text } label or folium.i18n.key(…)`);
        const known = byObject.get(text);
        if (known) return known;
        let made: string;
        if (isTextKey(text)) {
            const params = text.params && Object.keys(text.params).length > 0 ? text.params : null;
            made = params
                ? add(JSON.stringify(['key', text.i18nKey, params]), () => `$t(${modNamespace}:${text.i18nKey}, ${JSON.stringify(params)})`)
                : `${modNamespace}:${text.i18nKey}`;
        } else if (isLabel(text)) {
            const fallback = Object.values(text).find((entry): entry is string => typeof entry === 'string') ?? '';
            made = add(JSON.stringify(['label', text]), (language) => resolveFoliumLabel(text, language, fallback));
        } else {
            throw new TypeError(`${field} must be a string, a { language: text } label or folium.i18n.key(…)`);
        }
        byObject.set(text, made);
        return made;
    };

    return Object.freeze({
        namespace,
        key,
        now: (text: FoliumText | null | undefined, field: string) => {
            const found = key(text, field);
            return found ? i18n.t(found) : '';
        },
        dispose: () => {
            languages().forEach((language) => i18n.removeResourceBundle(language, namespace));
            added.clear();
            byString.clear();
        },
    });
};
