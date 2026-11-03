import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { libraryLayerOf } from '../../../dev/mcp/ts-code-map/libraryLayers.mjs';
import { getStoredVisualizerTunings } from '../../../src/components/visualizer/tuningRegistry';

// test/unit/stores/storeContract.test.ts
// Guards the invariants the settings-store split can silently break.
//
// These are not style rules. Each one corresponds to a failure that is invisible in review, and
// that no existing test covers:
//
//   storage keys — a renamed key does not fail anything, it just loses the listener's setting.
//   dependency graph — a cycle between stores surfaces as a default being `undefined` while a
//                      store initialises, not as a warning (see the note in automix/stems.ts).
//   per-frame values — a MotionValue's value in store state re-renders the tree at frame rate.
//
// Written against the source text rather than by importing the stores: several of them pull the
// visualizer registry, which is deliberately kept out of node-environment tests. The one thing
// imported is the tuning registry (plain data, no renderer): what the styles and the backgrounds
// declared for the store is read from it, not guessed from the shape of a source line.

// Stores live in src/stores and in the library core's feature folders, where the layer rule
// (dev/mcp/ts-code-map/libraryLayers.mjs) calls a file `use*Store.ts` state. Every check below covers
// all of them; a store is named by its file name, which is unique across those directories.
const REPO_ROOT = path.resolve(__dirname, '../../..');
const LIBRARY_CORE = 'src/library/core';
const isStoreFile = (dir: string, name: string) => name.endsWith('.ts')
    && (dir === 'src/stores' || libraryLayerOf(`${dir}/${name}`) === 'state');
const coreDirs = (dir: string): string[] => [dir, ...readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .flatMap(entry => coreDirs(`${dir}/${entry.name}`))];
const STORE_DIRS = ['src/stores', ...coreDirs(LIBRARY_CORE)]
    .filter(dir => readdirSync(path.join(REPO_ROOT, dir)).some(name => isStoreFile(dir, name)));
const storeDirOf = new Map<string, string>();
for (const dir of STORE_DIRS) {
    for (const name of readdirSync(path.join(REPO_ROOT, dir)).filter(entry => isStoreFile(dir, entry))) {
        storeDirOf.set(name, dir);
    }
}
const storeFiles = [...storeDirOf.keys()];
const readStore = (name: string) => readFileSync(path.join(REPO_ROOT, storeDirOf.get(name)!, name), 'utf8');
/** The stores one store imports (by id), whichever of the two directories either of them lives in. */
const storeImportsOf = (name: string, statement: RegExp) => [...readStore(name).matchAll(statement)]
    .map(match => path.posix.normalize(path.posix.join(storeDirOf.get(name)!, match[1])))
    .filter(target => storeDirOf.get(`${path.posix.basename(target)}.ts`) === path.posix.dirname(target))
    .map(target => path.posix.basename(target));

// A lyric style or a background that declares its own storage keeps its key in its tuning.ts
// (`storage: { key: '...', olderKeys: ['...'] }`); the settings store reads and writes under it.
// A background whose settings are no tuning object reads and writes its keys in its settings.ts.
const VISUALIZER_DIR = path.resolve(__dirname, '../../../src/components/visualizer');
const tuningFiles = readdirSync(VISUALIZER_DIR, { recursive: true, encoding: 'utf8' })
    .filter(name => /(^|[\\/])(tuning|settings)\.ts$/.test(name))
    .map(name => path.join(VISUALIZER_DIR, name));
const STORAGE_CALL = /localStorage\.(?:get|set|remove)Item\(\s*'([^']+)'/g;

/**
 * The stores the settings store reaches through the styles' and the backgrounds' folders. It
 * builds its fields from their tuning.ts and settings.ts files, so a store one of those files
 * imports, or a file of the visualizer folder it imports does (followed to the end; imports of
 * types only are not followed), is a store the settings store depends on.
 */
const storesBehindTunings = (): string[] => {
    const seen = new Set<string>();
    const stores = new Set<string>();
    const walk = (file: string) => {
        if (seen.has(file)) return;
        seen.add(file);
        for (const match of readFileSync(file, 'utf8').matchAll(/^import (?!type )[^;]*?from '(\.[^']+)';$/gm)) {
            const target = path.resolve(path.dirname(file), match[1]);
            const targetDir = path.relative(REPO_ROOT, path.dirname(target)).split(path.sep).join('/');
            if (STORE_DIRS.includes(targetDir) && isStoreFile(targetDir, `${path.basename(target)}.ts`)) {
                stores.add(path.basename(target));
                continue;
            }
            const found = [`${target}.ts`, `${target}.tsx`].find(candidate => existsSync(candidate));
            if (found && found.startsWith(VISUALIZER_DIR)) walk(found);
        }
    };
    tuningFiles.forEach(walk);
    return [...stores].sort();
};
const SETTINGS_STORE = 'useVisualizerSettingsStore';

describe('store contract', () => {
    it('keeps every localStorage key the stores read or write', () => {
        const keys = new Set<string>();
        for (const name of storeFiles) {
            const source = readStore(name);
            for (const match of source.matchAll(STORAGE_CALL)) {
                keys.add(match[1]);
            }
            // Keys held in a constant, which is how most of them are written.
            for (const match of source.matchAll(/^(?:export )?const \w*(?:KEY|Key) = '([^']+)';$/gm)) {
                keys.add(match[1]);
            }
        }
        for (const file of tuningFiles) {
            const source = readFileSync(file, 'utf8');
            for (const match of source.matchAll(STORAGE_CALL)) {
                keys.add(match[1]);
            }
        }
        for (const { storage } of getStoredVisualizerTunings()) {
            keys.add(storage.key);
            storage.olderKeys?.forEach(key => keys.add(key));
        }
        // A key that changes name does not break a build or a test — it silently drops whatever the
        // listener had chosen. This snapshot is the only thing standing between a rename and that.
        expect([...keys].sort()).toMatchSnapshot();
    });

    it('gives every stored tuning a store field, two actions and a storage key of its own', () => {
        // Two declarations with the same name would lay one tuning's field or action over the
        // other's, and two with the same key would write over each other, with no error anywhere.
        const tunings = getStoredVisualizerTunings();
        const names = tunings.flatMap(tuning => [tuning.settingsKey, tuning.settingsSetterKey, tuning.settingsResetterKey]);
        const keys = tunings.map(tuning => tuning.storage.key);
        expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([]);
        expect(keys.filter((key, index) => keys.indexOf(key) !== index)).toEqual([]);
        expect(tunings.length).toBeGreaterThanOrEqual(17);
    });

    it('keeps the store dependency graph acyclic', () => {
        const graph = new Map<string, string[]>();
        for (const name of storeFiles) {
            const id = name.replace(/\.ts$/, '');
            const deps = storeImportsOf(name, /from '(\.{1,2}\/[\w./]+)'/g);
            graph.set(id, id === SETTINGS_STORE ? [...deps, ...storesBehindTunings()] : deps);
        }

        const state = new Map<string, 'visiting' | 'done'>();
        const cycles: string[] = [];
        const walk = (id: string, trail: string[]) => {
            if (state.get(id) === 'done') return;
            if (state.get(id) === 'visiting') {
                cycles.push([...trail.slice(trail.indexOf(id)), id].join(' -> '));
                return;
            }
            state.set(id, 'visiting');
            for (const dep of graph.get(id) ?? []) walk(dep, [...trail, id]);
            state.set(id, 'done');
        };
        for (const id of graph.keys()) walk(id, []);

        expect(cycles).toEqual([]);
    });

    it('keeps no per-frame value in store state', () => {
        // motionSignals is the one module allowed to hold MotionValues: it holds the instances and
        // never their values, which is the whole distinction. Everything else must stay clear.
        const offenders = storeFiles
            .filter(name => name !== 'motionSignals.ts')
            .filter(name => /\bmotionValue\(|\buseMotionValue\(/.test(readStore(name)));

        expect(offenders).toEqual([]);
    });

    it('keeps store-to-store coupling to the edges that were argued for', () => {
        // tsc already rejects an import of something that does not exist. What it cannot see is a
        // NEW dependency between two domain stores, which is how a set of independent stores turns
        // back into one tangle. Every edge below had a reason; a new one needs the same.
        const ALLOWED: Record<string, string[]> = {
            // Clearing a monet/cappella asset has to fall its tuning back, so the settings store
            // drives the asset store. The reverse edge is deliberately absent: it would close a cycle.
            // The edge runs through the styles' folders (cappella, monet, the monet background),
            // which the settings store loads: see storesBehindTunings.
            useVisualizerSettingsStore: ['useVisualizerAssetStore'],
            // Turning off "remember home card position" has to drop the positions already kept,
            // so the settings store drives the position store. Same shape as the edge above, and
            // the reverse edge is likewise absent: the position store imports no store at all.
            useHomeLayoutSettingsStore: ['useHomeCardPositionStore'],
        };
        const INFRASTRUCTURE = new Set([
            'storagePrimitives', 'useStatusMessageStore', 'visualizerSettingsPersistence', 'motionSignals',
        ]);

        const edges: string[] = [];
        for (const name of storeFiles) {
            const from = name.replace(/\.ts$/, '');
            if (INFRASTRUCTURE.has(from)) continue;
            const direct = storeImportsOf(name, /^import [^;]*from '(\.{1,2}\/[\w./]+)';$/gm);
            for (const to of from === SETTINGS_STORE ? [...direct, ...storesBehindTunings()] : direct) {
                if (INFRASTRUCTURE.has(to) || ALLOWED[from]?.includes(to)) continue;
                edges.push(`${from} -> ${to}`);
            }
        }

        expect(edges).toEqual([]);
        // The argued edge is there, and it is found: a scan that stopped following the folders would pass the lines above with nothing to check.
        expect(storesBehindTunings()).toContain('useVisualizerAssetStore');
    });

    it('leaves no reference to a store module that no longer exists', () => {
        // Two ways to name a store that tsc cannot check, both of which fail silently:
        //   a Playwright spec importing a store by runtime path string inside page.evaluate
        //   a vi.mock naming a store by alias - mocking a missing module is a no-op, so the suite
        //   quietly runs the real store instead of the fixture it thinks it installed
        // Splitting a store leaves both behind. This is the only thing that reports it.
        const ROOTS = ['src', 'test', 'dev'].map(dir => path.resolve(__dirname, '../../..', dir));
        const knownIn = (dir: string) => new Set(storeFiles
            .filter(name => storeDirOf.get(name) === dir)
            .map(name => name.replace(/\.ts$/, '')));
        const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(full);
            return /\.tsx?$/.test(entry.name) ? [full] : [];
        });

        const dangling: string[] = [];
        for (const file of ROOTS.flatMap(walk)) {
            const source = readFileSync(file, 'utf8');
            for (const dir of STORE_DIRS) {
                // The three spellings above (runtime path, alias, bare path), for each store directory.
                const known = knownIn(dir);
                const full = dir.replace(/\//g, '\\/');
                const alias = dir.replace(/^src\//, '').replace(/\//g, '\\/');
                // In the core's feature folders only `use*Store` names are stores; the other files there are not.
                const name = dir === 'src/stores' ? '(\\w+)' : '(use\\w*Store)';
                const named = [
                    ...source.matchAll(new RegExp(`['"]\\/${full}\\/${name}\\.ts['"]`, 'g')),
                    ...source.matchAll(new RegExp(`['"]@\\/${alias}\\/${name}['"]`, 'g')),
                    ...source.matchAll(new RegExp(`\\b${full}\\/${name}\\.ts\\b`, 'g')),
                ].map(match => match[1]);
                for (const name of new Set(named)) {
                    if (!known.has(name)) {
                        dangling.push(`${path.relative(REPO_ROOT, file)} -> ${dir}/${name}`);
                    }
                }
            }
        }

        expect(dangling).toEqual([]);
    });
});
