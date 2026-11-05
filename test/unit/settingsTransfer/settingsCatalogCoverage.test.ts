import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SETTINGS_CATALOG, SETTINGS_EXCLUDED } from '../../../src/services/settingsTransfer/settingsCatalog';

// test/unit/settingsTransfer/settingsCatalogCoverage.test.ts
// A setting that reaches another machine only if settingsCatalog.ts names it. One that is named
// in neither the catalog nor the exclusion list does not fail anything by itself: the export keeps
// working and quietly leaves that setting behind. This reads the stores' source the way
// storeContract.test.ts does and fails on such a key, so adding a setting comes with a decision:
// carry it, or say why it stays.
//
// Written against the source text rather than by importing the stores: several of them pull the
// visualizer registry, which is deliberately kept out of node-environment tests.

const REPO_ROOT = path.resolve(__dirname, '../../..');
const STORE_DIRS = ['src/stores', 'src/library/core'];

const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap(entry => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));

// The two ways a store names a key: inline at the call, or as a constant it then passes on.
const KEY_PATTERNS = [
    /localStorage\.(?:get|set|remove)Item\(\s*'([^']+)'/g,
    /(?:STORAGE_KEY|_KEY)\s*=\s*'([^']+)'/g,
];

// Scoped to the settings stores on purpose. The lyric styles' and backgrounds' own tunings are
// stored by the visualizer settings store and travel in the visual config code's
// `visualizerTunings` field (see skills/settings-feature-integration/SKILL.md); a whole-settings
// bundle does not carry them a second time, so scanning their `storage: { key }` declarations here
// would demand entries this feature deliberately does not have.

const scanForKeys = (files: string[], patterns: RegExp[]): Set<string> => {
    const keys = new Set<string>();
    for (const file of files) {
        const source = readFileSync(file, 'utf8');
        for (const pattern of patterns) {
            for (const match of source.matchAll(pattern)) {
                keys.add(match[1]);
            }
        }
    }
    return keys;
};

const storeFiles = STORE_DIRS.flatMap(dir => walk(path.join(REPO_ROOT, dir)))
    .filter(file => /use[A-Za-z]+Store\.ts$/.test(file));

const storeKeys = scanForKeys(storeFiles, KEY_PATTERNS);

const catalogKeys = new Set(SETTINGS_CATALOG.map(entry => entry.key));
const excludedKeys = new Set(SETTINGS_EXCLUDED.map(entry => entry.key));

describe('settings catalog coverage', () => {
    it('reads some keys from the stores, so a broken scan is not a silent pass', () => {
        expect(storeFiles.length).toBeGreaterThan(20);
        expect(storeKeys.size).toBeGreaterThan(100);
    });

    it('has no key in both the catalog and the exclusion list', () => {
        const overlap = [...catalogKeys].filter(key => excludedKeys.has(key));
        expect(overlap).toEqual([]);
    });

    it('names every key the stores store, either to carry it or to leave it', () => {
        const unaccounted = [...storeKeys]
            .filter(key => !catalogKeys.has(key) && !excludedKeys.has(key))
            .sort();
        expect(
            unaccounted,
            'A setting in src/stores is in neither SETTINGS_CATALOG nor SETTINGS_EXCLUDED: it would '
            + 'be silently left out of an exported bundle. Add it to settingsCatalog.ts, or to the '
            + 'exclusion list with the reason it stays on this machine.',
        ).toEqual([]);
    });

    it('carries no key the stores do not store, so a renamed setting does not linger here', () => {
        const stale = [...catalogKeys].filter(key => !storeKeys.has(key)).sort();
        expect(stale).toEqual([]);
    });

    it('keeps the exclusion list free of keys nothing stores any more', () => {
        const stale = [...excludedKeys].filter(key => !storeKeys.has(key)).sort();
        expect(stale).toEqual([]);
    });
});
