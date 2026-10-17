import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// test/unit/electron/modelPaths.test.ts
// The weights can sit in three places now - the user's own folder, the directory the app downloads
// into, and whatever the installer shipped - and the two models are separate downloads of 41MB and
// 190MB. So "beat_this from one directory, htdemucs from another" is an ordinary state, and
// resolving per DIRECTORY rather than per FILE would silently ignore half of what is installed.

const require = createRequire(import.meta.url);
const { resolveModelFile, modelsPresent, legacyLeftovers, MODEL_FILES, LEGACY_RUNTIME_BIN } = require('../../../electron/analysis/modelPaths.cjs');

let root: string;
let userDir: string;
let downloadDir: string;
let bundledDir: string;

const put = (dir: string, name: string, body = 'weights') => {
    writeFileSync(path.join(dir, MODEL_FILES[name]), body);
};

beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'folia-models-'));
    [userDir, downloadDir, bundledDir] = ['user', 'download', 'bundled'].map((name) => {
        const dir = path.join(root, name);
        mkdirSync(dir);
        return dir;
    });
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('finding model weights', () => {
    it('is null for a model that is nowhere', () => {
        expect(resolveModelFile([userDir, downloadDir, bundledDir], 'beat_this')).toBeNull();
        expect(modelsPresent([userDir, downloadDir, bundledDir]))
            .toEqual({ beat_this: false, htdemucs: false, htdemucs_gpu: false });
    });

    it('takes each model from the first directory that has it, independently', () => {
        put(downloadDir, 'beat_this');
        put(bundledDir, 'htdemucs');
        put(userDir, 'htdemucs_gpu');
        const dirs = [userDir, downloadDir, bundledDir];

        expect(resolveModelFile(dirs, 'beat_this')).toBe(path.join(downloadDir, 'beat_this-wgsl.bin'));
        expect(resolveModelFile(dirs, 'htdemucs')).toBe(path.join(bundledDir, 'htdemucs-v3.mnn'));
        // The runtime is compiled into the app, so the file being there is the feature being able to run.
        expect(resolveModelFile(dirs, 'htdemucs_gpu')).toBe(path.join(userDir, 'htdemucs-wgsl.bin'));
        expect(modelsPresent(dirs)).toEqual({ beat_this: true, htdemucs: true, htdemucs_gpu: true });
    });

    // A file the listener put somewhere deliberately outranks one we fetched, which is the whole
    // point of the setting: it is the escape hatch for everyone our download routes cannot reach.
    it('prefers the user directory over the download and the bundle', () => {
        put(userDir, 'beat_this');
        expect(resolveModelFile([userDir, downloadDir, bundledDir], 'beat_this'))
            .toBe(path.join(userDir, 'beat_this-wgsl.bin'));
    });

    // The configured directory is null until the user picks one, and it is passed through as such.
    it('skips empty entries rather than resolving against the process working directory', () => {
        expect(resolveModelFile([null, undefined, '', bundledDir], 'htdemucs'))
            .toBe(path.join(bundledDir, 'htdemucs-v3.mnn'));
        expect(resolveModelFile([], 'htdemucs')).toBeNull();
    });

    // The files earlier versions ran - the ONNX models and the Python runtime beside them - are not
    // models to this one. A listener who has only those has nothing this version can run.
    it('does not count an earlier version\'s files as installed', () => {
        const old = path.join(root, 'old-version');
        const exe = path.join(old, 'runtime', ...LEGACY_RUNTIME_BIN);
        mkdirSync(path.dirname(exe), { recursive: true });
        writeFileSync(exe, 'not really python');
        for (const name of ['beat_this.onnx', 'htdemucs-v2.onnx', 'htdemucs.onnx']) writeFileSync(path.join(old, name), 'weights');
        expect(modelsPresent([old])).toEqual({ beat_this: false, htdemucs: false, htdemucs_gpu: false });
        expect(legacyLeftovers([old]).sort()).toEqual(
            ['beat_this.onnx', 'htdemucs-v2.onnx', 'htdemucs.onnx', 'runtime'].map(name => path.join(old, name)).sort(),
        );
        expect(legacyLeftovers([userDir, null])).toEqual([]);
    });

    // The listener's own directory may hold a folder called `runtime` that is nothing of ours. Only the
    // old build's runtime - its interpreter where that build put it - is ever offered for deletion.
    it('does not take a folder called runtime for the old Python runtime', () => {
        const mine = path.join(root, 'someone-elses-runtime');
        mkdirSync(path.join(mine, 'runtime', 'bin'), { recursive: true });
        writeFileSync(path.join(mine, 'runtime', 'notes.txt'), 'mine');
        expect(legacyLeftovers([mine])).toEqual([]);
    });

    it('does not mistake a directory of that name for the weights file', () => {
        const oddDir = path.join(root, 'odd');
        mkdirSync(path.join(oddDir, 'htdemucs-v3.mnn'), { recursive: true });
        // existsSync says yes for a directory, so this is the one shape of wrong answer that would
        // reach the runtime as a native load failure rather than as "no weights".
        expect(modelsPresent([oddDir]).htdemucs).toBe(false);
    });
});

describe('the bundled small0 export', () => {
    it('resolves from the installer copy, and is not one of the downloadable models', () => {
        put(bundledDir, 'beat_this_small');
        expect(resolveModelFile([userDir, downloadDir, bundledDir], 'beat_this_small'))
            .toBe(path.join(bundledDir, 'beat_this-small-wgsl.bin'));
        expect(Object.keys(modelsPresent([userDir, downloadDir, bundledDir])).sort()).toEqual(['beat_this', 'htdemucs', 'htdemucs_gpu']);
    });
});
