import { readFileSync } from 'node:fs';
import path from 'node:path';

// test/unit/stores/storedKeys.ts
// Every localStorage key a set of store files reads or writes, read from the source text.
//
// Two tests ask the same question: storeContract.test.ts, for the snapshot that pins the key names,
// and settingsCatalogCoverage.test.ts, for what a whole-settings export carries. Each used to carry
// its own scanner, and both went blind in the same places, so the keys they missed were in neither
// the snapshot nor the catalog and nothing was red:
//   - a key held in a constant counted only when the name ended in KEY, so `_STORAGE_KEY_V2` did not
//     count (preferred_alternative_lyric_source_v2);
//   - only a literal at the call counted: not a constant handed to a `*Stored` helper, and not an
//     inline literal at one, which is how most of the keys are written;
//   - a constant imported from src/utils/ was not seen at all, and the four visualizer and equalizer
//     keys are all imported from there (audio_equalizer_settings, lyric_render_quality,
//     visualizer_frame_rate, visualizer_glow_blur_quantize);
//   - a KEY-named constant that is not a storage key was taken for one.
// The scan lives here now, so a fix reaches both callers.

/**
 * KEY-named values that are not storage keys: the import plan's per-side theme rows and the switch
 * that activates the custom theme (src/utils/appearanceImportPlan.ts). The name rule below matches
 * them, and the scan has no other way to tell.
 */
export const NOT_STORAGE_KEYS: readonly string[] = ['themeLight', 'themeDark', 'activateCustomTheme'];

/** One source file to scan, with the directory its relative imports are resolved against. */
export type StoredKeySource = {
    /** Absolute path of the file to read. */
    file: string;
    /** Absolute directory of the constants stores import instead of restating: src/utils. */
    sharedDir: string;
};

// A key is written in one of these shapes:
//   const ANY_KEY = 'value'   a KEY- or Key-named constant, ending in it or not; the value has to be
//                             a plain key, which leaves out a type union and a module symbol
//   localStorage.setItem('value', ...)   inline at the call
//   any.setItem(SOME_KEY, ...)           one that a real storage call passes as well
//   setStoredString('value', ...)        inline at the src/stores/storagePrimitives.ts family
//   setStoredString(SOME_KEY, ...)       handed a constant, whose name need not mention KEY
const CONSTANT = /^\s*(?:export )?(?:const|let|var) (\w*(?:KEY|Key)\w*) = '([^'\s$]*)';/gm;
const INLINE = /localStorage\.(?:get|set|remove)Item\(\s*'([^']+)'/g;
const ITEM_CALL = /\.(?:get|set|remove)Item\(\s*'([^']+)'/g;
const STORED_CALL_LITERAL = /(?:get|set|remove)Stored\w*\(\s*'([^']+)'/g;
const STORED_CALL_ARGUMENT = /(?:get|set|remove)Stored\w*\(\s*([\w[\].]+)/g;
const NAMED_CONSTANT = /(?:const|let|var) (\w+) = '([^'\s$]*)';/g;
const RELATIVE_IMPORT = /^import (?!type )[^;]*?from '(\.{1,2}\/[^']+)';$/gm;

const isUnder = (file: string, dir: string) => {
    const relative = path.relative(dir, file);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

/** The file an import specifier points at, in module resolution's order, or null when there is none. */
const importedFile = (specifier: string, fromFile: string): string | null => {
    const target = path.resolve(path.dirname(fromFile), specifier);
    for (const candidate of [target, `${target}.ts`, `${target}.tsx`, path.join(target, 'index.ts')]) {
        try {
            if (readFileSync(candidate)) return candidate;
        } catch {
            // Not this one.
        }
    }
    return null;
};

/** The KEY-named constants a file declares, by value, and every named constant by name. */
const constantsOf = (source: string) => {
    const keyed = new Map<string, string>();
    const named = new Map<string, string>();
    for (const match of source.matchAll(NAMED_CONSTANT)) {
        named.set(match[1], match[2]);
        if (/KEY|Key/.test(match[1])) keyed.set(match[1], match[2]);
    }
    return { keyed, named };
};

/**
 * The storage keys of the given files.
 *
 * A key is named in a store file itself: inline at a `localStorage` call, inline at a `*Stored`
 * helper, or as the value of a constant that helper is handed. Or it is a KEY-named constant of a
 * file the store imports relatively from under `sharedDir`: the constants of src/utils/ are
 * imported rather than restated, and that is most of what the scan used to miss.
 *
 * NOT_STORAGE_KEYS is excluded at the end and nothing else is: the result is meant to be complete,
 * so a caller that expects a key only has to ask whether it is there.
 */
export const storedKeysOf = (sources: readonly StoredKeySource[]): Set<string> => {
    const keys = new Set<string>();
    for (const { file, sharedDir } of sources) {
        const source = readFileSync(file, 'utf8');
        for (const match of source.matchAll(CONSTANT)) keys.add(match[2]);
        for (const match of source.matchAll(INLINE)) keys.add(match[1]);
        for (const match of source.matchAll(STORED_CALL_LITERAL)) keys.add(match[1]);
        const { keyed, named } = constantsOf(source);
        for (const match of source.matchAll(STORED_CALL_ARGUMENT)) {
            const value = named.get(match[1].replace(/\[.*$/, ''));
            if (value !== undefined) keys.add(value);
        }
        for (const match of source.matchAll(RELATIVE_IMPORT)) {
            const target = importedFile(match[1], file);
            if (!target || !isUnder(target, sharedDir)) continue;
            for (const value of constantsOf(readFileSync(target, 'utf8')).keyed.values()) keys.add(value);
        }
    }
    NOT_STORAGE_KEYS.forEach(key => keys.delete(key));
    return keys;
};
