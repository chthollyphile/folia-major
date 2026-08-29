import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// test/unit/electron/modelPaths.test.ts
// The weights can sit in three places now - the user's own folder, the directory the app downloads
// into, and whatever the installer shipped - and the two models are separate downloads of 83MB and
// 166MB. So "beat_this from one directory, htdemucs from another" is an ordinary state, and
// resolving per DIRECTORY rather than per FILE would silently ignore half of what is installed.

const require = createRequire(import.meta.url);
const {
    resolveModelFile, modelsPresent, resolveRuntime, resolveRuntimeDir, RUNTIME_BIN,
} = require('../../../electron/analysis/modelPaths.cjs');

let root: string;
let userDir: string;
let downloadDir: string;
let bundledDir: string;

const put = (dir: string, name: string, body = 'weights') => {
    writeFileSync(path.join(dir, `${name}.onnx`), body);
};

/** A runtime that would pass the check: the interpreter where this platform puts it, and nothing else. */
const putRuntime = (dir: string) => {
    const exe = path.join(dir, 'runtime', ...RUNTIME_BIN);
    mkdirSync(path.dirname(exe), { recursive: true });
    writeFileSync(exe, 'not really python');
    return exe;
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
            .toEqual({ beat_this: false, htdemucs: false });
    });

    it('takes each model from the first directory that has it, independently', () => {
        put(downloadDir, 'beat_this');
        put(bundledDir, 'htdemucs');
        const dirs = [userDir, downloadDir, bundledDir];

        expect(resolveModelFile(dirs, 'beat_this')).toBe(path.join(downloadDir, 'beat_this.onnx'));
        expect(resolveModelFile(dirs, 'htdemucs')).toBe(path.join(bundledDir, 'htdemucs.onnx'));
        // htdemucs is false with its weights RIGHT THERE, and that is the point - see below.
        expect(modelsPresent(dirs)).toEqual({ beat_this: true, htdemucs: false });
    });

    /**
     * modelsPresent answers "can the feature run", and separation needs two downloads: the weights
     * and the Python they run in. Reporting the .onnx alone is how the settings page came to promise
     * the full engine on a machine where every separation silently fell back to a plain crossfade -
     * the weights were there, the runtime never had a download route at all, and nothing said so.
     */
    it('does not call htdemucs present until the runtime is there too', () => {
        const alone = path.join(root, 'weights-only');
        mkdirSync(alone, { recursive: true });
        put(alone, 'htdemucs');

        expect(resolveModelFile([alone], 'htdemucs')).toBe(path.join(alone, 'htdemucs.onnx'));
        expect(modelsPresent([alone]).htdemucs).toBe(false);

        const exe = putRuntime(alone);
        expect(modelsPresent([alone]).htdemucs).toBe(true);
        expect(resolveRuntime([alone])).toBe(exe);
        expect(resolveRuntimeDir([alone])).toBe(path.join(alone, 'runtime'));
    });

    // beat_this runs in Electron's own onnxruntime-node and never touches the sidecar, so the
    // runtime's absence must not drag it down with htdemucs.
    it('leaves beat_this alone when there is no runtime', () => {
        const alone = path.join(root, 'beat-only');
        mkdirSync(alone, { recursive: true });
        put(alone, 'beat_this');
        expect(modelsPresent([alone])).toEqual({ beat_this: true, htdemucs: false });
    });

    // The folder can be there while the interpreter is not: an extraction that died half way,
    // or a delete that got part way through. Either way it cannot run anything.
    it('does not call an empty runtime folder a runtime', () => {
        const hollow = path.join(root, 'hollow');
        mkdirSync(path.join(hollow, 'runtime'), { recursive: true });
        put(hollow, 'htdemucs');
        expect(resolveRuntimeDir([hollow])).toBeNull();
        expect(modelsPresent([hollow]).htdemucs).toBe(false);
    });

    // A file the listener put somewhere deliberately outranks one we fetched, which is the whole
    // point of the setting: it is the escape hatch for everyone our download routes cannot reach.
    it('prefers the user directory over the download and the bundle', () => {
        put(userDir, 'beat_this');
        expect(resolveModelFile([userDir, downloadDir, bundledDir], 'beat_this'))
            .toBe(path.join(userDir, 'beat_this.onnx'));
    });

    // The configured directory is null until the user picks one, and it is passed through as such.
    it('skips empty entries rather than resolving against the process working directory', () => {
        expect(resolveModelFile([null, undefined, '', bundledDir], 'htdemucs'))
            .toBe(path.join(bundledDir, 'htdemucs.onnx'));
        expect(resolveModelFile([], 'htdemucs')).toBeNull();
    });

    it('does not mistake a directory of that name for the weights file', () => {
        const oddDir = path.join(root, 'odd');
        mkdirSync(path.join(oddDir, 'htdemucs.onnx'), { recursive: true });
        // existsSync says yes for a directory, so this is the one shape of wrong answer that would
        // reach onnxruntime as a native load failure rather than as "no weights".
        expect(modelsPresent([oddDir]).htdemucs).toBe(false);
    });
});
