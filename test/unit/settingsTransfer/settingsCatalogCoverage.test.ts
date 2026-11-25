import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APPEARANCE_DESTINATIONS } from '../../../dev/dedicatus/appearanceDestinations.mjs';
import {
    SETTINGS_CATALOG,
    SETTINGS_EXCLUDED,
    SETTINGS_VISUAL_CONFIG_KEYS,
} from '../../../src/services/settingsTransfer/settingsCatalog';
import { storedKeysOf } from '../stores/storedKeys';

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
const SRC_ROOT = path.join(REPO_ROOT, 'src');
// Constants a store imports instead of restating live here; the scan follows the relative imports
// that reach into it (see test/unit/stores/storedKeys.ts).
const SHARED_DIR = path.join(SRC_ROOT, 'utils');
// A store that is not named use*Store.ts still holds settings. visualizerSettingsPersistence.ts is
// the one the stores read their persisted visualizer values through, and it is where several keys
// are literally written; a rule keyed on the file name left them in neither list, and the test did
// not notice (review of #1041). Any new file of this shape belongs here.
const STORE_COMPANION_FILES = ['stores/visualizerSettingsPersistence.ts'];

const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap(entry => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));

// Scoped to the settings stores on purpose. The lyric styles' and backgrounds' own tunings are
// stored by the visualizer settings store and travel in the visual config code's
// `visualizerTunings` field (see skills/settings-feature-integration/SKILL.md); a whole-settings
// bundle does not carry them a second time, so scanning their `storage: { key }` declarations here
// would demand entries this feature deliberately does not have.

// Every use*Store.ts anywhere under src/, not only the directories that hold most of them: a store
// in its feature's own directory (src/mods, src/components/scenes/settings) stores settings just the
// same, and scanning only the two crowded directories let a new one go unnoticed (review of #1041).
const storeFiles = [
    ...walk(SRC_ROOT).filter(file => /use[A-Za-z]+Store\.ts$/.test(file)),
    ...STORE_COMPANION_FILES.map(file => path.join(SRC_ROOT, file)),
];

// The same scan storeContract.test.ts pins its snapshot with, so the two cannot drift apart: a key
// this one cannot see is one the snapshot cannot see either, and storedKeys.test.ts is what says so.
const storeKeys = storedKeysOf(storeFiles.map(file => ({ file, sharedDir: SHARED_DIR })));

const catalogKeys = new Set(SETTINGS_CATALOG.map(entry => entry.key));
const excludedKeys = new Set(SETTINGS_EXCLUDED.map(entry => entry.key));
const visualConfigKeys = new Set(SETTINGS_VISUAL_CONFIG_KEYS.map(entry => entry.key));

// The visual config code's own field table says, key by key, whether a key travels in the shortcode.
// A key it carries is left out of this bundle so one setting has one way to reach the other machine;
// a key it does not carry (an option the web OBS page cannot show) belongs in the bundle.
const carriedByVisualConfig = new Set(
    Object.entries(APPEARANCE_DESTINATIONS as Record<string, { config: string | null }>)
        .filter(([, destination]) => destination.config !== null)
        .map(([key]) => key),
);

describe('settings catalog coverage', () => {
    it('reads some keys from the stores, so a broken scan is not a silent pass', () => {
        expect(storeFiles.length).toBeGreaterThan(20);
        expect(storeKeys.size).toBeGreaterThan(100);
    });

    it('puts a key in exactly one of the three lists', () => {
        const twice = [
            ...[...catalogKeys].filter(key => excludedKeys.has(key) || visualConfigKeys.has(key)),
            ...[...excludedKeys].filter(key => visualConfigKeys.has(key)),
        ].sort();
        expect(twice, 'A key can only travel one way: carried here, left on this machine, or carried '
            + 'by the visual config code. Listing it twice makes which one depends on the order read.').toEqual([]);
    });

    it('leaves every key the visual config code carries out of the bundle', () => {
        const duplicated = [...carriedByVisualConfig].filter(key => catalogKeys.has(key)).sort();
        expect(duplicated, 'The visual config code already carries this key. Carrying it here too is '
            + 'the duplicate the review asked to settle: one setting has one way across.').toEqual([]);
    });

    it('carries a key the visual config code does not, rather than dropping it from both', () => {
        const dropped = [...storeKeys]
            .filter(key => carriedByVisualConfig.has(key) && !visualConfigKeys.has(key))
            .sort();
        expect(dropped, 'The visual config code carries this key, so SETTINGS_VISUAL_CONFIG_KEYS must '
            + 'name it; otherwise it reaches neither machine.').toEqual([]);
    });

    it('names every key the stores store, either to carry it or to leave it', () => {
        const unaccounted = [...storeKeys]
            .filter(key => !catalogKeys.has(key) && !excludedKeys.has(key) && !visualConfigKeys.has(key))
            .sort();
        expect(
            unaccounted,
            'A setting in src/stores is in neither SETTINGS_CATALOG nor SETTINGS_EXCLUDED: it would '
            + 'be silently left out of an exported bundle. Add it to settingsCatalog.ts, or to the '
            + 'exclusion list with the reason it stays on this machine.',
        ).toEqual([]);
    });

    it('carries no key the stores do not store, so a renamed setting does not linger here', () => {
        const stale = [...catalogKeys, ...visualConfigKeys].filter(key => !storeKeys.has(key)).sort();
        expect(stale).toEqual([]);
    });

    it('keeps the exclusion list free of keys nothing stores any more', () => {
        const stale = [...excludedKeys].filter(key => !storeKeys.has(key)).sort();
        expect(stale).toEqual([]);
    });
});
