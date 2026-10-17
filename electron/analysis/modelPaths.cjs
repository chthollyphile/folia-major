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
// Resolved per FILE rather than per directory. The two models are separate downloads of 83MB and 166MB and
// a build may still bundle one of them, so "beat_this from the user's folder, htdemucs from the installer"
// is an ordinary state rather than a corner case.

/** Every model this app knows how to run. The order is the order the settings page lists them in. */
const MODEL_NAMES = ['beat_this', 'htdemucs'];

/**
 * The file names a model may be installed under, current first. The current one is the manifest's
 * `file`, what a download writes.
 *
 * htdemucs changed files without changing models: htdemucs-v2.onnx has the STFT and iSTFT taken out of
 * the graph (build/htdemucs_cut_fft.py), and an app from before that cannot run it. A new file name is
 * what keeps those apps working - overwriting htdemucs.onnx on the mirrors would have failed every one
 * of their downloads on the hash. The old name still counts as installed here, because the runner
 * still runs it: a listener who already has it keeps separation, just without the speed-up.
 */
const MODEL_FILES = {
    beat_this: ['beat_this.onnx'],
    htdemucs: ['htdemucs-v2.onnx', 'htdemucs.onnx'],
};

/**
 * The first of `dirs` that actually holds this model, or null.
 *
 * Order is the caller's: the user's own directory first, then what the app downloaded, then what
 * the installer shipped. A file the user put somewhere deliberately outranks one we fetched, so the
 * directory order wins over the file names' - within one directory, the current file wins.
 */
const resolveModelFile = (dirs, name) => {
    for (const dir of dirs) {
        if (!dir) continue;
        for (const fileName of MODEL_FILES[name] ?? [`${name}.onnx`]) {
            const file = path.join(dir, fileName);
            // isFile rather than existsSync: a DIRECTORY of that name passes existsSync, and the result is
            // the settings page reporting the model installed while onnxruntime gets handed a folder.
            // Unlikely, but it is the "answers confidently and wrongly" shape, which this subsystem has
            // paid for enough times to spend one stat on.
            if (fs.statSync(file, { throwIfNoEntry: false })?.isFile()) return file;
        }
    }
    return null;
};

/**
 * Weights for the hand-written WebGPU runtime (src/services/automix/beatThisWgsl), by model: the
 * fp16 export of build/beat_this_wgsl/export_weights.py, a .bin and its .json manifest. They are a
 * different file from the .onnx, read by the renderer rather than by worker.cjs, so they are looked
 * up on their own; the .onnx still decides whether the model counts as installed.
 */
const GPU_WEIGHTS = { beat_this: 'beat_this-wgsl' };

/** `{ bin, manifest }` from the first of `dirs` holding BOTH files of this model's GPU export, or null. */
const resolveGpuWeights = (dirs, name) => {
    const base = GPU_WEIGHTS[name];
    if (!base) return null;
    for (const dir of dirs) {
        if (!dir) continue;
        const bin = path.join(dir, `${base}.bin`);
        const manifest = path.join(dir, `${base}.json`);
        // A pair from one directory or nothing: a manifest from one export over another's weights reads
        // every tensor at the wrong offset, which no check downstream would notice.
        if (fs.statSync(bin, { throwIfNoEntry: false })?.isFile() && fs.statSync(manifest, { throwIfNoEntry: false })?.isFile()) {
            return { bin, manifest };
        }
    }
    return null;
};

// The Python runtime htdemucs separation needs - an optional download that lands as a `runtime/`
// folder beside the model files, in the same directories, best first. htdemucs is the one model not
// run over onnxruntime-node; the reason is at the top of htdemucs_runner.py. Everything else (beat_this)
// ignores this entirely.
const RUNTIME_NAME = 'runtime';
/** Where the interpreter sits inside the runtime directory. Set by build/buildPythonRuntime.mjs. */
const RUNTIME_BIN = process.platform === 'win32' ? ['python.exe'] : ['bin', 'python3'];

/**
 * The installed runtime DIRECTORY, or null. Probed by the interpreter inside it, never by the
 * folder existing: a half-extracted archive leaves the folder there, and a runtime directory with
 * no interpreter in it would otherwise read as installed.
 */
const resolveRuntimeDir = (dirs) => {
    for (const dir of dirs) {
        if (!dir) continue;
        const home = path.join(dir, RUNTIME_NAME);
        if (fs.statSync(path.join(home, ...RUNTIME_BIN), { throwIfNoEntry: false })?.isFile()) return home;
    }
    return null;
};

/** The runtime interpreter's path if a usable runtime is installed in one of `dirs`, else null. */
const resolveRuntime = (dirs) => {
    const home = resolveRuntimeDir(dirs);
    return home && path.join(home, ...RUNTIME_BIN);
};

const runtimePresent = (dirs) => resolveRuntime(dirs) !== null;

/**
 * `{ beat_this: true, htdemucs: false }` for the settings page. A few stats, nothing loaded.
 *
 * This answers "can the feature RUN", not "is the file there", and for htdemucs those are
 * different questions: the weights are useless without the interpreter that runs them, and that is
 * a separate download. Reporting the .onnx alone is how a machine with the model and no runtime
 * gets a settings page promising the full engine while every separation silently declines - the
 * exact failure this file's header is about, and it was live here until this line was written.
 */
const modelsPresent = (dirs) => Object.fromEntries(MODEL_NAMES.map(name => [
    name,
    resolveModelFile(dirs, name) !== null && (name !== 'htdemucs' || runtimePresent(dirs)),
]));

/** What a per-platform manifest entry is keyed by. Matches Electron's own two strings. */
const PLATFORM = `${process.platform}-${process.arch}`;

/**
 * The manifest's downloadables as they apply to THIS machine, with the platform variant folded in.
 *
 * The models are one file for everyone; the runtime is a different archive per platform and does
 * not exist for all of them. Rather than teach every caller that difference, a per-platform entry
 * comes back looking exactly like a plain one - same `file`, `bytes`, `sha256` - plus `supported`.
 *
 * Unsupported platforms are RETURNED, not filtered out, which is the whole point of the flag: the
 * settings page has to draw a row saying this machine cannot run separation. Dropping the entry
 * would leave it silently absent, and "the feature isn't offered" and "the feature isn't listed"
 * look identical to someone who came looking for it.
 */
const downloadables = (manifest, platform = PLATFORM) => {
    const resolved = manifest.models.map((entry) => {
        if (!entry.platforms) return { ...entry, supported: true };
        const { platforms, ...rest } = entry;
        const variant = platforms[platform];
        return variant ? { ...rest, ...variant, supported: true } : { ...rest, supported: false };
    });

    // A download is offered only when the thing it switches on can actually run here. The weights
    // are one file for every platform, so htdemucs.onnx resolves fine where the runtime has no build - and is 108MB
    // that will never separate anything, because the runtime it needs has no build for that machine.
    // Offering it is the same lie as a settings page reporting an engine with no weights behind it,
    // just told in the other direction. `enables` is what ties them: both entries buy `stems`, and
    // neither is worth having without the other.
    const blocked = new Set(resolved.filter(entry => !entry.supported).map(entry => entry.enables));
    return resolved.map(entry => (blocked.has(entry.enables) ? { ...entry, supported: false } : entry));
};

module.exports = {
    MODEL_NAMES, MODEL_FILES, RUNTIME_NAME, RUNTIME_BIN, PLATFORM,
    GPU_WEIGHTS, resolveGpuWeights,
    resolveModelFile, modelsPresent, resolveRuntime, resolveRuntimeDir, runtimePresent, downloadables,
};
