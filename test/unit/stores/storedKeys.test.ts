import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOT_STORAGE_KEYS, storedKeysOf, type StoredKeySource } from './storedKeys';

// test/unit/stores/storedKeys.test.ts
// The scan the snapshot and the settings catalog are both judged by. Those two tests only go red when
// a key is NEW, so a key the scan cannot see is invisible in both directions: it is in neither the
// snapshot nor the catalog and nothing fails. This one asks the scan directly, about the keys that
// were in exactly that gap.

const REPO_ROOT = path.resolve(__dirname, '../../..');
const STORE_DIRS = ['src/stores', 'src/library/core'];
const SHARED_DIR = path.join(REPO_ROOT, 'src/utils');
const APPEARANCE_PLAN = path.join(REPO_ROOT, 'src/utils/appearanceImportPlan.ts');

// The keys no scanner saw before this module existed, each for a reason of its own.
const MISSED_KEYS = [
    // A name that ends in KEY is not the only name a key has: this one ends in _V2.
    'preferred_alternative_lyric_source_v2',
    // Constants of src/utils/ that a store imports and passes on by identifier: audioEqualizer
    // calls the storage itself, the other three go through the visualizer settings store.
    'audio_equalizer_settings',
    'lyric_render_quality',
    'visualizer_frame_rate',
    'visualizer_glow_blur_quantize',
];

// Where each one is written, so the list above does not quietly stop matching the tree.
const DECLARED_IN: Record<string, string> = {
    preferred_alternative_lyric_source_v2: 'src/stores/useLyricSettingsStore.ts',
    audio_equalizer_settings: 'src/utils/audioEqualizer.ts',
    lyric_render_quality: 'src/utils/lyricRenderQuality.ts',
    visualizer_frame_rate: 'src/utils/frameRateLimiter.ts',
    visualizer_glow_blur_quantize: 'src/utils/glowBlurQuantize.ts',
};

const filesUnder = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap(entry => (entry.isDirectory() ? filesUnder(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));

// The same set storeContract.test.ts scans for the snapshot: every store file, nothing else.
const storeFiles = STORE_DIRS.flatMap(dir => filesUnder(path.join(REPO_ROOT, dir)))
    .filter(file => /\.ts$/.test(file));

const keysOf = (files: readonly string[]) => storedKeysOf(
    files.map((file): StoredKeySource => ({ file, sharedDir: SHARED_DIR })),
);

describe('stored keys scan', () => {
    it('finds every key the earlier scans went blind to', () => {
        const keys = keysOf(storeFiles);
        const missing = MISSED_KEYS.filter(key => !keys.has(key));
        expect(missing, 'the scan cannot see these: the snapshot and the catalog both pass without them').toEqual([]);
    });

    it('finds them in files that exist, so the expectation above is not guessing', () => {
        const absent = Object.values(DECLARED_IN).filter(relative => !existsSync(path.join(REPO_ROOT, relative)));
        expect(absent).toEqual([]);
    });

    it('leaves out the KEY-named constants that are not storage keys', () => {
        const keys = keysOf([...storeFiles, APPEARANCE_PLAN]);
        expect(NOT_STORAGE_KEYS.filter(key => keys.has(key))).toEqual([]);
    });

    it('still reads every shape of key it read before, so the fix did not narrow the scan', () => {
        const keys = keysOf(storeFiles);
        // A KEY-named constant in a store, an inline literal at a *Stored call, and a legacy
        // constant whose name says LEGACY rather than anything about storage.
        const expected = ['player_chrome_hidden', 'player_is_muted', 'enable_media_cache'];
        expect(expected.filter(key => !keys.has(key))).toEqual([]);
    });

    it('reads the comments of a source as it reads the code, and a shape from the comment is not a key', () => {
        const keys = storedKeysOf([{ file: path.resolve(__dirname, 'storedKeys.ts'), sharedDir: SHARED_DIR }]);
        // The module's own comment spells the shapes out as `const ANY_KEY = 'value'` and
        // `setStoredString('value', ...)`; both match the patterns, and neither is a key a store
        // reads. It costs a fake key in a scan of the scan, not a wrong answer about a store.
        expect([...keys]).toEqual(['value']);
    });
});
