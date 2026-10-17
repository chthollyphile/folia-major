import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// test/unit/electron/modelPaths.test.ts
// Both models ship in the installer and are read from its models directory: htdemucs (automix's CPU
// stems) and htdemucs_gpu (the beat FX' drum stem) are one file. What earlier versions downloaded into
// userData/models is deleted - only by exact name, and only there.

const require = createRequire(import.meta.url);
const {
    resolveModelFile, modelsPresent, legacyLeftovers, removeDownloadedLeftovers, MODEL_FILES, LEGACY_RUNTIME_BIN,
} = require('../../../electron/analysis/modelPaths.cjs');

let root: string;
let bundledDir: string;

const put = (dir: string, name: string, body = 'weights') => {
    writeFileSync(path.join(dir, MODEL_FILES[name]), body);
};

beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'folia-models-'));
    bundledDir = path.join(root, 'bundled');
    mkdirSync(bundledDir);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('finding model weights', () => {
    it('is null for a model that is nowhere', () => {
        expect(resolveModelFile([bundledDir], 'beat_this')).toBeNull();
        expect(modelsPresent([bundledDir])).toEqual({ beat_this: false, htdemucs: false, htdemucs_gpu: false });
    });

    it('reads both models from the installer\'s directory, htdemucs for both engines from one file', () => {
        put(bundledDir, 'beat_this');
        put(bundledDir, 'htdemucs');
        expect(resolveModelFile([bundledDir], 'beat_this')).toBe(path.join(bundledDir, 'beat_this-wgsl.bin'));
        expect(resolveModelFile([bundledDir], 'htdemucs')).toBe(path.join(bundledDir, 'htdemucs-wgsl.bin'));
        expect(resolveModelFile([bundledDir], 'htdemucs_gpu')).toBe(path.join(bundledDir, 'htdemucs-wgsl.bin'));
        expect(modelsPresent([bundledDir])).toEqual({ beat_this: true, htdemucs: true, htdemucs_gpu: true });
    });

    it('skips empty entries rather than resolving against the process working directory', () => {
        expect(resolveModelFile([null, undefined, '', bundledDir], 'htdemucs'))
            .toBe(path.join(bundledDir, 'htdemucs-wgsl.bin'));
        expect(resolveModelFile([], 'htdemucs')).toBeNull();
    });

    it('knows no small0 any more', () => {
        expect(resolveModelFile([bundledDir], 'beat_this_small')).toBeNull();
    });

    it('does not mistake a directory of that name for the weights file', () => {
        const oddDir = path.join(root, 'odd');
        mkdirSync(path.join(oddDir, 'htdemucs-wgsl.bin'), { recursive: true });
        // existsSync says yes for a directory, so this is the one shape of wrong answer that would
        // reach the runtime as a native load failure rather than as "no weights".
        expect(modelsPresent([oddDir]).htdemucs).toBe(false);
    });
});

describe('what earlier versions downloaded', () => {
    const OLD = [
        'beat_this.onnx', 'htdemucs-v2.onnx', 'htdemucs.onnx',
        'htdemucs-v3.mnn', 'beat_this-wgsl.bin', 'htdemucs-wgsl.bin', 'beat_this-small-wgsl.bin',
    ];

    it('finds the old files and the old Python runtime by exact name, and deletes them', async () => {
        const downloads = path.join(root, 'userData-models');
        const exe = path.join(downloads, 'runtime', ...LEGACY_RUNTIME_BIN);
        mkdirSync(path.dirname(exe), { recursive: true });
        writeFileSync(exe, 'not really python');
        for (const name of OLD) writeFileSync(path.join(downloads, name), 'weights');
        writeFileSync(path.join(downloads, 'notes.txt'), 'mine');
        expect(legacyLeftovers([downloads]).sort()).toEqual([...OLD, 'runtime'].map(name => path.join(downloads, name)).sort());

        const { removed, bytes } = await removeDownloadedLeftovers(downloads);
        expect(removed).toHaveLength(OLD.length + 1);
        expect(bytes).toBe(OLD.length * 'weights'.length);
        expect(legacyLeftovers([downloads])).toEqual([]);
        expect(existsSync(path.join(downloads, 'notes.txt'))).toBe(true);
    });

    // A folder called `runtime` that is nothing of ours: only the old build's runtime - its interpreter
    // where that build put it - is ever deleted.
    it('does not take a folder called runtime for the old Python runtime', () => {
        const mine = path.join(root, 'someone-elses-runtime');
        mkdirSync(path.join(mine, 'runtime', 'bin'), { recursive: true });
        writeFileSync(path.join(mine, 'runtime', 'notes.txt'), 'mine');
        expect(legacyLeftovers([mine])).toEqual([]);
    });

    it('answers nothing for a directory that is not there', async () => {
        expect(await removeDownloadedLeftovers(path.join(root, 'never-made'))).toEqual({ removed: [], bytes: 0 });
    });
});
