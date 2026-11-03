const path = require('path');
const fs = require('fs');

// electron/analysis/modelPaths.cjs
// Where a model file is, given the places it is allowed to be.
//
// Plain node on purpose: worker.cjs runs in a utilityProcess and may not require 'electron', and host.cjs
// needs to answer "is it there?" with the SAME expression the worker gates on. When those two drifted
// apart the symptom was a settings page promising an engine the worker had no weights for, so they are one
// function rather than two identical-looking ones.
//
// Both models ship inside the installer now, and are read from its models directory alone: Beat This!
// final0 and htdemucs, each as its WebGPU export, which the renderer's GPU runtime and the worker's MNN
// both read. Nothing is downloaded any more; what earlier versions downloaded is deleted
// (removeDownloadedLeftovers).

/** Every model this app runs. modelsPresent answers for each. */
const MODEL_NAMES = ['beat_this', 'htdemucs', 'htdemucs_gpu'];

/**
 * The file a model is under. htdemucs (automix's stems, on the CPU) and htdemucs_gpu (智能动感模式's
 * drum stem, on the GPU) are one file: native/folia-mnn/folia_htdemucs.cpp builds the CPU network over
 * the same tensors the GPU runs (build/htdemucs_wgsl/export_weights.py). Two names because the renderer
 * asks after each feature's engine; the answer is the same file. Beat This! is final0, exported with
 * --f16 (build/beat_this_wgsl/export_weights.py), which the CPU fallback reads too
 * (folia_beat_this.cpp); 智能动感模式 and automix share it and its stored beat lists.
 */
const MODEL_FILES = {
    beat_this: 'beat_this-wgsl.bin',
    htdemucs: 'htdemucs-wgsl.bin',
    htdemucs_gpu: 'htdemucs-wgsl.bin',
};

/**
 * What earlier versions downloaded into userData/models and this one never reads: the ONNX models,
 * the Python runtime htdemucs ran in, the MNN htdemucs (htdemucs-v3.mnn), and the two exports this
 * version ships itself (it reads the installer's copies). Up to a few hundred MB, deleted at startup
 * (removeDownloadedLeftovers) - from that directory only, never the installer's models directory,
 * which holds this version's own beat_this-wgsl.bin and htdemucs-wgsl.bin.
 *
 * The files go by exact name. The runtime is a DIRECTORY named `runtime`, and the first directory
 * searched is one the listener chose, so a folder of that name counts only with the interpreter the
 * old build put inside it - never `rm -rf` on a name alone.
 */
const LEGACY_FILES = [
    'beat_this.onnx', 'htdemucs-v2.onnx', 'htdemucs.onnx',
    'htdemucs-v3.mnn', 'beat_this-wgsl.bin', 'htdemucs-wgsl.bin', 'beat_this-small-wgsl.bin',
];
const LEGACY_RUNTIME = 'runtime';
/** Where the old build (build/buildPythonRuntime.mjs, removed) put the interpreter inside it. */
const LEGACY_RUNTIME_BIN = process.platform === 'win32' ? ['python.exe'] : ['bin', 'python3'];

/** The legacy files and runtime directories present in `dirs`, as paths. */
const legacyLeftovers = (dirs) => dirs.filter(Boolean).flatMap((dir) => {
    const files = LEGACY_FILES.map(name => path.join(dir, name))
        .filter(file => fs.statSync(file, { throwIfNoEntry: false })?.isFile());
    const runtime = path.join(dir, LEGACY_RUNTIME);
    const isOldRuntime = fs.statSync(path.join(runtime, ...LEGACY_RUNTIME_BIN), { throwIfNoEntry: false })?.isFile();
    return isOldRuntime ? [...files, runtime] : files;
});

/** Bytes under `target`: a file's size, or every file's below a directory. */
const sizeOf = async (target) => {
    const stat = await fs.promises.lstat(target).catch(() => null);
    if (!stat) return 0;
    if (!stat.isDirectory()) return stat.isFile() ? stat.size : 0;
    let bytes = 0;
    for (const entry of await fs.promises.readdir(target).catch(() => [])) bytes += await sizeOf(path.join(target, entry));
    return bytes;
};

/**
 * The legacy files and runtime in `dir` and what they take on disk (the runtime counted whole), for
 * asking the listener before deleting them: `{ paths, bytes }`, no paths when there is nothing.
 */
const measureLeftovers = async (dir) => {
    const paths = legacyLeftovers([dir]);
    let bytes = 0;
    for (const leftover of paths) bytes += await sizeOf(leftover);
    return { paths, bytes };
};

/**
 * Deletes the legacy files and runtime in `dir` and resolves to `{ removed, bytes }`. Rejects on the
 * first that will not go; the next launch tries again.
 *
 * Only the names in LEGACY_FILES and an old runtime are touched, never `dir` itself or anything else
 * in it - which is what makes it safe on the folder an earlier version let the listener choose (the
 * 模型目录 setting, up to 0.7.20), deleted there only once they say so (main.cjs).
 *
 * @param dir userData/models, or that chosen folder - never the installer's models directory (see LEGACY_FILES)
 */
const removeDownloadedLeftovers = async (dir) => {
    const removed = [];
    let bytes = 0;
    for (const leftover of legacyLeftovers([dir])) {
        const stat = await fs.promises.stat(leftover);
        bytes += stat.isFile() ? stat.size : 0;
        await fs.promises.rm(leftover, { recursive: true, force: true });
        removed.push(leftover);
    }
    return { removed, bytes };
};

/**
 * The first of `dirs` that actually holds this model, or null.
 *
 * In practice one directory, the installer's; a list so a dev checkout's models/ resolves the same way.
 */
const resolveModelFile = (dirs, name) => {
    const fileName = MODEL_FILES[name];
    if (!fileName) return null;
    for (const dir of dirs) {
        if (!dir) continue;
        const file = path.join(dir, fileName);
        // isFile rather than existsSync: a DIRECTORY of that name passes existsSync, and the result is
        // the settings page reporting the model installed while the runtime gets handed a folder.
        // Unlikely, but it is the "answers confidently and wrongly" shape, which this subsystem has
        // paid for enough times to spend one stat on.
        if (fs.statSync(file, { throwIfNoEntry: false })?.isFile()) return file;
    }
    return null;
};

/**
 * `{ beat_this: true, htdemucs: true, htdemucs_gpu: true }`: a few stats, nothing loaded. False only
 * in a build or checkout without the files (a dev checkout before `npm run models:fetch`).
 *
 * The weights are all each feature needs: the runtime that runs them is compiled into the app
 * (native/folia-mnn), so "the file is there" and "the feature can run" are the same answer.
 */
const modelsPresent = (dirs) => Object.fromEntries(MODEL_NAMES.map(name => [name, resolveModelFile(dirs, name) !== null]));

module.exports = {
    MODEL_NAMES, MODEL_FILES, LEGACY_FILES, LEGACY_RUNTIME_BIN, legacyLeftovers, measureLeftovers, removeDownloadedLeftovers, resolveModelFile, modelsPresent,
};
