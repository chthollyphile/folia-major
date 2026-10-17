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
// Resolved per FILE rather than per directory. The models are separate downloads of 41MB, 190MB and 92MB and
// a build may still bundle one of them, so "beat_this from the user's folder, htdemucs from the installer"
// is an ordinary state rather than a corner case.

/**
 * Every model this app knows how to run. The order is the order the settings page lists them in.
 *
 * htdemucs_gpu is the same htdemucs as htdemucs, exported for the renderer's WebGPU runtime
 * (build/htdemucs_wgsl/export_weights.py, src/services/analysis/htdemucsWgsl): the drum stem behind
 * 智能动感模式, GPU only. Its own download because the CPU model is an MNN graph whose weights no
 * other runtime can read, and the beat FX must not need automix's 190MB to get its 92MB.
 */
const MODEL_NAMES = ['beat_this', 'htdemucs', 'htdemucs_gpu'];

/**
 * The file a model is installed under. One file per model, and the manifest's `file` - what a download
 * writes.
 *
 * Both are new names, because both are new files an older app cannot run: htdemucs-v3.mnn is the
 * MNN build of the model (build/htdemucs_mnn/make_model.py), and beat_this-wgsl.bin is the WebGPU export
 * with its manifest packed in (packedWeights.cjs), which the CPU fallback reads too. Reusing an old
 * name would have failed every older app's download on the hash.
 */
const MODEL_FILES = {
    beat_this: 'beat_this-wgsl.bin',
    htdemucs: 'htdemucs-v3.mnn',
    htdemucs_gpu: 'htdemucs-wgsl.bin',
    beat_this_small: 'beat_this-small-wgsl.bin',
};

/**
 * Models that ship inside the app rather than download: not in MODEL_NAMES (the settings page's list,
 * and what `modelsPresent` answers), not in shared/modelManifest.json (what a download or "delete
 * all" acts on). Resolved from the installer's own models directory ONLY: a pinned file has no
 * business being replaced by one of the same name in a folder the listener chose, which nothing
 * would hash-check.
 *
 * beat_this_small is the authors' small0 checkpoint (2.1M parameters against final0's 20M), exported
 * like final0 with --f16 into one 4.7MB file. Not in git: packaging/beat-this-small pulls the pinned
 * release into models/ at build time, and extraResources ships it. 智能动感模式 runs it, on
 * the GPU only; automix keeps final0, and the CPU fallback never sees this file.
 */
const BUNDLED_MODEL_NAMES = ['beat_this_small'];

/**
 * What earlier versions installed and this one no longer runs: the ONNX models, and the Python runtime
 * htdemucs ran in. Nothing resolves them any more, so nothing would ever delete them either - up to a
 * few hundred MB per directory - and "delete all models" removes these too (modelStore.cjs removeAll).
 *
 * The files go by exact name. The runtime is a DIRECTORY named `runtime`, and the first directory
 * searched is one the listener chose, so a folder of that name counts only with the interpreter the
 * old build put inside it - never `rm -rf` on a name alone.
 */
const LEGACY_FILES = ['beat_this.onnx', 'htdemucs-v2.onnx', 'htdemucs.onnx'];
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

/**
 * The first of `dirs` that actually holds this model, or null.
 *
 * Order is the caller's: the user's own directory first, then what the app downloaded, then what
 * the installer shipped. A file the user put somewhere deliberately outranks one we fetched.
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
 * `{ beat_this: true, htdemucs: false }` for the settings page. A few stats, nothing loaded.
 *
 * The weights are all each feature needs now: the runtime that runs them is compiled into the app
 * (native/folia-mnn), so "the file is there" and "the feature can run" are the same answer again.
 */
const modelsPresent = (dirs) => Object.fromEntries(MODEL_NAMES.map(name => [name, resolveModelFile(dirs, name) !== null]));

module.exports = {
    MODEL_NAMES, MODEL_FILES, BUNDLED_MODEL_NAMES, LEGACY_FILES, LEGACY_RUNTIME_BIN, legacyLeftovers, resolveModelFile, modelsPresent,
};
