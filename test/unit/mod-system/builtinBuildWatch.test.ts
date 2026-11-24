import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import {
    IPC, cleanHarness, clearModRecords, harness, invoke, launch, modRecord, resetHarness, sourceManifest, stateOf, writeMod,
} from './loaderHarness';
import { buildSource } from '../../../dev/sources/build.mjs';

// test/unit/mod-system/builtinBuildWatch.test.ts
// Folium 2.0 S4 in the main-process loader: what dev/sources/build.mjs writes into dist-mods/ loads as the `builtin`
// tier (the gate of S4, here with the archive unpacked to a folder of its name, since Node reads no .asar), and in a
// development build a rebuild of one mod (its build.json) reloads that mod alone (electron/modSystem/builtinBuildWatch.cjs).

const require = createRequire(import.meta.url);
const { createBuiltinBuildWatch, readBuildFingerprint } = require('../../../electron/modSystem/builtinBuildWatch.cjs') as {
    createBuiltinBuildWatch: (options: {
        directory: string; onChange: () => void; debounceMs?: number; retryMs?: number;
        watch?: (dir: string, listener: (event: string, filename: string | null) => void) => { close: () => void };
        exists?: (dir: string) => boolean;
    }) => { start: () => void; stop: () => void };
    readBuildFingerprint: (dir: string) => string | null;
};
const asar = require('@electron/asar') as { extractAll: (archive: string, dest: string) => void };
const FIXTURE = path.resolve(__dirname, '../../fixtures/folium-sources/fixture-source');

beforeEach(() => {
    resetHarness();
    clearModRecords();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
    cleanHarness();
    clearModRecords();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

const stamp = (directory: string, fingerprint: string) => {
    fs.writeFileSync(path.join(directory, 'build.json'), JSON.stringify({ fingerprint, files: [] }));
};

describe('the build stamp', () => {
    it('gives the fingerprint of a built folder, and nothing for a folder without one or with a broken one', () => {
        const directory = writeMod('builtin', sourceManifest('stamped', ['stamped']), { main: true });
        expect(readBuildFingerprint(directory)).toBeNull();
        stamp(directory, '0123456789abcdef');
        expect(readBuildFingerprint(directory)).toBe('0123456789abcdef');
        fs.writeFileSync(path.join(directory, 'build.json'), '{"fingerprint": "../../etc"}');
        expect(readBuildFingerprint(directory)).toBeNull();
    });
});

describe('the watch on dist-mods/', () => {
    const fakeWatch = () => {
        const listeners: Array<(event: string, filename: string | null) => void> = [];
        const watch = vi.fn((_dir: string, listener: (event: string, filename: string | null) => void) => {
            listeners.push(listener);
            return { close: vi.fn() };
        });
        return { watch, emit: (filename: string) => listeners.forEach((listener) => { listener('change', filename); }) };
    };

    it('reloads once per burst of written build.json files, and ignores every other file', () => {
        vi.useFakeTimers();
        const onChange = vi.fn();
        const { watch, emit } = fakeWatch();
        const watcher = createBuiltinBuildWatch({ directory: '/dist-mods', onChange, watch, exists: () => true, debounceMs: 100 });
        watcher.start();
        vi.advanceTimersByTime(500);
        expect(onChange).not.toHaveBeenCalled();
        emit(path.join('fixture', 'index.cjs'));
        emit(path.join('fixture', 'build.json'));
        emit(path.join('other', 'build.json'));
        vi.advanceTimersByTime(100);
        expect(onChange).toHaveBeenCalledTimes(1);
        emit(path.join('fixture', 'client.mjs'));
        vi.advanceTimersByTime(500);
        expect(onChange).toHaveBeenCalledTimes(1);
        watcher.stop();
        emit(path.join('fixture', 'build.json'));
        vi.advanceTimersByTime(500);
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('waits for a dist-mods/ that is not there yet, and then counts what was built meanwhile', () => {
        vi.useFakeTimers();
        const onChange = vi.fn();
        const { watch } = fakeWatch();
        let there = false;
        const watcher = createBuiltinBuildWatch({ directory: '/dist-mods', onChange, watch, exists: () => there, debounceMs: 100, retryMs: 1000 });
        watcher.start();
        vi.advanceTimersByTime(3000);
        expect(watch).not.toHaveBeenCalled();
        there = true;
        vi.advanceTimersByTime(1100);
        expect(watch).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledTimes(1);
        watcher.stop();
    });
});

describe('built-in mods rebuilt in a development build', () => {
    it('restarts only the mod whose build.json moved, with a new client URL', async () => {
        const first = writeMod('builtin', sourceManifest('first', ['first']), { main: true });
        const second = writeMod('builtin', sourceManifest('second', ['second']), { main: true });
        stamp(first, 'aaaaaaaaaaaaaaaa');
        stamp(second, 'bbbbbbbbbbbbbbbb');
        const system = launch();
        const urlOf = (modId: string) => stateOf(system, modId)?.clientUrl;
        const before = { first: urlOf('first'), second: urlOf('second') };
        expect(before.first).toContain('aaaaaaaaaaaaaaaa');

        stamp(first, 'cccccccccccccccc');
        await system.reloadChanged();
        expect(modRecord('first')).toMatchObject({ activations: 2, deactivations: 1 });
        expect(modRecord('second')).toMatchObject({ activations: 1, deactivations: 0 });
        expect(urlOf('first')).not.toBe(before.first);
        expect(urlOf('first')).toContain('cccccccccccccccc');
        expect(urlOf('second')).toBe(before.second);
        system.dispose();
    });

    it('keeps reading the versions alone in a packaged app', () => {
        const directory = writeMod('builtin', sourceManifest('packaged', ['packaged']), { main: true });
        stamp(directory, 'aaaaaaaaaaaaaaaa');
        const system = launch({ isPackaged: true });
        expect(stateOf(system, 'packaged')?.clientUrl ?? '').not.toContain('aaaaaaaaaaaaaaaa');
        system.dispose();
    });
});

describe('what dev/sources/build.mjs builds (the gate of S4)', () => {
    it('loads from dist-mods/ as the builtin tier, its source under its own id, and its main entry answers over rpc', async () => {
        const { outDir } = await buildSource(FIXTURE, { outRoot: harness().builtinDir });
        // Node reads no .asar: the archive unpacked to a folder of the same name stands in for it (Electron reads the file).
        const archive = fs.readdirSync(outDir).find((name) => name.startsWith('deps.')) as string;
        const bytes = path.join(harness().root, 'archive.asar');
        fs.renameSync(path.join(outDir, archive), bytes);
        asar.extractAll(bytes, path.join(outDir, archive));

        const system = launch();
        const mod = stateOf(system, 'fixture-source');
        expect(mod).toMatchObject({
            status: 'loaded', tier: 'builtin', kind: 'source', signature: { status: 'builtin' }, mainState: 'ready',
            sources: [expect.objectContaining({ id: 'folium.fixture-source.probe', localId: 'probe', state: 'enabled' })],
        });
        expect(mod?.clientUrl).toMatch(/^folia-mod:\/\/fixture-source\/client\.mjs\?v=builtin/);
        expect(mod?.clientUrl).toContain(JSON.parse(fs.readFileSync(path.join(outDir, 'build.json'), 'utf8')).fingerprint);
        const answer = await invoke(IPC.rpc, 'fixture-source', 'search', ['晴天']) as { ok: boolean; result: Array<{ title: string }> };
        expect(answer.result.map((row) => row.title)).toEqual([
            '晴天 · bundle:晴天', '晴天 · alpha@1.0.0+leaf', '晴天 · beta@1.0.0+leaf', '晴天 · worker:bundle:晴天:2', '晴天 · vendor:esm-only',
        ]);
        system.dispose();
    }, 60_000);
});
