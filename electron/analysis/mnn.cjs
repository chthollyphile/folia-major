const fs = require('fs');
const os = require('os');
const path = require('path');
const { readPackedManifest } = require('./packedWeights.cjs');

// electron/analysis/mnn.cjs
// The CPU runtime both analysis models run on: MNN, compiled into native/folia-mnn and reached
// through koffi. Plain node, no 'electron', so worker.cjs can require it in its utilityProcess and
// a test or a dev script can require it from anywhere.
//
// This replaced two runtimes at once - onnxruntime-node for beat_this' CPU path, and a downloaded
// Python with onnxruntime for htdemucs - and with them the second process a separation used to
// spawn. One library, built with the app for each platform, nothing to download beside the weights.
//
// The one call that takes real time, `run`, goes through koffi's async path: the inference runs on a
// thread of its own and this process's event loop stays free, which onnxruntime-node's "async" run
// never was (see the top of worker.cjs). Everything else is a short synchronous call.

/** Matches folia_mnn_abi() in native/folia-mnn/folia_mnn.cpp. */
const ABI = 2;

/** The library's file name on this platform. */
const LIBRARY_FILE = process.platform === 'win32' ? 'folia_mnn.dll'
    : process.platform === 'darwin' ? 'libfolia_mnn.dylib' : 'libfolia_mnn.so';

/** Precision codes of folia_mnn_load. Both models ship and are checked in fp32: `high`. */
const PRECISION = { normal: 0, high: 1, low: 2 };

const MAX_RANK = 8;

/**
 * Where the library is: FOLIA_MNN_LIBRARY when set (dev and tests), else the packaged copy under
 * resources/mnn, else the developer's own build in build/mnn/<mac|win|linux>-<arch> (build/buildMnnRuntime.mjs).
 */
const libraryPath = () => {
    const osName = { darwin: 'mac', win32: 'win' }[process.platform] ?? process.platform;
    const candidates = [
        process.env.FOLIA_MNN_LIBRARY,
        process.resourcesPath && path.join(process.resourcesPath, 'mnn', LIBRARY_FILE),
        path.join(__dirname, '..', '..', 'build', 'mnn', `${osName}-${process.arch}`, LIBRARY_FILE),
    ];
    return candidates.find(file => file && fs.statSync(file, { throwIfNoEntry: false })?.isFile()) ?? null;
};

let bound = null;

/** The library's functions, bound once; throws with the reason when there is no usable library. */
const bind = () => {
    if (bound) return bound;
    const file = libraryPath();
    if (!file) throw new Error(`no ${LIBRARY_FILE} (set FOLIA_MNN_LIBRARY, or run build/buildMnnRuntime.mjs)`);
    const koffi = require('koffi');
    const lib = koffi.load(file);
    const handle = koffi.pointer('FoliaMnn', koffi.opaque());
    const weights = koffi.pointer('FoliaBtWeights', koffi.opaque());
    const fns = {
        abi: lib.func('int folia_mnn_abi()'),
        load: lib.func('folia_mnn_load', handle, ['str', 'int', 'int', 'int', 'char *', 'int']),
        free: lib.func('folia_mnn_free', 'void', [handle]),
        inputCount: lib.func('folia_mnn_input_count', 'int', [handle]),
        inputShape: lib.func('folia_mnn_input_shape', 'int', [handle, 'int', 'int *', 'int']),
        setInput: lib.func('folia_mnn_set_input', 'int', [handle, 'int', 'float *', 'int *', 'int']),
        run: lib.func('folia_mnn_run', 'int', [handle]),
        error: lib.func('folia_mnn_error', 'int', [handle, 'char *', 'int']),
        outputCount: lib.func('folia_mnn_output_count', 'int', [handle]),
        outputShape: lib.func('folia_mnn_output_shape', 'int', [handle, 'int', 'int *', 'int']),
        output: lib.func('folia_mnn_output', 'int64_t', [handle, 'int', 'float *', 'int64_t']),
        clear: lib.func('folia_mnn_clear', 'void', [handle]),
        isa: lib.func('const char* folia_mnn_isa()'),
        preferFastCores: lib.func('int folia_mnn_prefer_fast_cores()'),
        btCreate: lib.func('folia_bt_weights_create', weights, []),
        btFree: lib.func('folia_bt_weights_free', 'void', [weights]),
        btPut: lib.func('folia_bt_weights_put', 'int', [weights, 'str', 'uint8_t *', 'int', 'int *', 'int', 'int']),
        btBuild: lib.func('folia_bt_build', handle, [weights, 'int', 'char *', 'int']),
        hdBuild: lib.func('folia_hd_build', handle, [weights, 'int', 'str', 'char *', 'int']),
    };
    const abi = fns.abi();
    if (abi !== ABI) throw new Error(`${file} speaks interface ${abi}, this build expects ${ABI}`);
    bound = fns;
    return bound;
};

const message = (buf) => buf.toString('utf8', 0, Math.max(0, buf.indexOf(0))) || 'unknown error';

/**
 * Loads a model. Resolves to `{ inputShape(i), run(inputs), release() }`, or throws with why not.
 *
 * `run([{ data: Float32Array, dims: number[] }, ...])` - inputs in the model's own order - resolves
 * to `[{ data: Float32Array, dims: number[] }, ...]`, the outputs in the model's order, copied out.
 *
 * @param file absolute path to a .mnn
 * @param options.threads CPU threads for this model
 * @param options.precision 'high' (fp32 throughout), 'normal' or 'low'
 * @param options.shapeMutable true when the input shape changes between runs
 */
const loadModel = (file, { threads = 4, precision = 'high', shapeMutable = false } = {}) => {
    const fns = bind();
    const err = Buffer.alloc(1024);
    const handle = fns.load(file, threads, PRECISION[precision] ?? PRECISION.high, shapeMutable ? 1 : 0, err, err.length);
    if (!handle) throw new Error(message(err));
    return wrap(fns, handle);
};

/**
 * Beat This! on the CPU from the WebGPU export - beat_this-wgsl.bin, tensors and manifest in one file
 * (packedWeights.cjs) - rather than from a model file of its own: the network is built in
 * native/folia-mnn/folia_beat_this.cpp over these tensors, so the CPU fallback needs no second copy of
 * the weights. Resolves like loadModel; the one input is a mel chunk [frames, 128] of 1..1500 frames,
 * the outputs are beat and downbeat logits.
 *
 * @param file absolute path to the export
 */
const loadBeatThis = (file, { threads = 4 } = {}) => buildFromExport(file, 'beat_this', 'btBuild', threads);

/**
 * htdemucs on the CPU from its WebGPU export, htdemucs-wgsl.bin, the one copy of the model the app
 * ships: the network is built in native/folia-mnn/folia_htdemucs.cpp over these tensors. Resolves like
 * loadModel; the one input is a stereo segment [1, 2, 172032] at 44.1kHz, the one output the four
 * stems [1, 4, 2, 172032] in the graph's order (htdemucs.cjs).
 *
 * @param file absolute path to the export
 * @param options.scratchDir where the library may write (and then deletes) the convolutions' weights
 */
const loadHtdemucs = (file, { threads = 4, scratchDir = os.tmpdir() } = {}) => {
    // The library writes the convolutions' weights here and deletes the file before it returns
    // (folia_hd_build); the unlink below only covers a build that died between the two.
    const scratch = path.join(scratchDir, `folia-htdemucs-${process.pid}-${Date.now()}.weights`);
    try {
        return buildFromExport(file, 'htdemucs', 'hdBuild', threads, [scratch]);
    } finally {
        fs.rmSync(scratch, { force: true });
    }
};

/**
 * Every tensor of the packed export at `file` handed to the library, then the network built over them by
 * `build`, whose arguments after the weights and the thread count are `extra`. The tensors are read one
 * at a time through one buffer the size of the largest: the whole file (92MB for htdemucs) read into this
 * process would be handed back to the allocator afterwards, not to the system.
 */
const buildFromExport = (file, model, build, threads, extra = []) => {
    const fns = bind();
    const fd = fs.openSync(file, 'r');
    const set = fns.btCreate();
    try {
        const size = fs.fstatSync(fd).size;
        const manifest = readPackedManifest(fd, size);
        const span = (entry) => {
            // stride: a padded row length, the padding inside the tensor's own bytes (beat_this' matmuls)
            const cols = entry.shape[entry.shape.length - 1];
            const count = entry.shape.reduce((a, b) => a * b, 1);
            const pitch = entry.stride || cols;
            return (count / cols) * pitch * (entry.dtype === 'f16' ? 2 : 4);
        };
        const entries = Object.entries(manifest.tensors);
        const buffer = Buffer.allocUnsafe(Math.max(0, ...entries.map(([, entry]) => span(entry))));
        for (const [name, entry] of entries) {
            const bytes = span(entry);
            if (entry.byte_offset + bytes > manifest.bytes || fs.readSync(fd, buffer, 0, bytes, entry.byte_offset) !== bytes) {
                throw new Error(`${model} tensor ${name} runs past the end of the weights`);
            }
            const shape = Int32Array.from(entry.shape);
            if (fns.btPut(set, name, buffer, entry.dtype === 'f16' ? 1 : 0, shape, shape.length, entry.stride ?? 0) !== 0) {
                throw new Error(`${model} tensor ${name} [${entry.shape}] was refused`);
            }
        }
        const err = Buffer.alloc(1024);
        const handle = fns[build](set, threads, ...extra, err, err.length);
        if (!handle) throw new Error(message(err));
        return wrap(fns, handle);
    } finally {
        fns.btFree(set);
        fs.closeSync(fd);
    }
};

/** The instruction set the library's own operators use on this CPU, for the log. */
const isa = () => bind().isa();

/**
 * Prefers this process's threads on the fast cores of a hybrid Windows CPU, so a minimised app's
 * separation is not 2.2x slower on efficiency cores. Answers how many cores were chosen, 0 for a no-op
 * (any other OS, a non-hybrid CPU). See folia_mnn_prefer_fast_cores.
 */
const preferFastCores = () => bind().preferFastCores();

const wrap = (fns, handle) => {
    let live = true;
    const alive = () => {
        if (!live) throw new Error('model already released');
    };

    const shapeOf = (read, index) => {
        const dims = new Int32Array(MAX_RANK);
        const rank = read(handle, index, dims, MAX_RANK);
        return rank < 0 ? null : Array.from(dims.subarray(0, rank));
    };

    return {
        inputCount: fns.inputCount(handle),
        /** The declared shape of input `index`; a dynamic axis reads -1. */
        inputShape: (index) => {
            alive();
            return shapeOf(fns.inputShape, index);
        },
        run: async (inputs) => {
            alive();
            inputs.forEach(({ data, dims }, index) => {
                const count = dims.reduce((a, b) => a * b, 1);
                if (data.length < count) throw new Error(`input ${index} has ${data.length} floats for shape [${dims}]`);
                if (fns.setInput(handle, index, data, Int32Array.from(dims), dims.length) !== 0) {
                    throw new Error(`input ${index} of shape [${dims}] was refused`);
                }
            });
            const status = await new Promise((resolve, reject) => {
                fns.run.async(handle, (error, result) => (error ? reject(error) : resolve(result)));
            });
            if (status !== 0) {
                const buf = Buffer.alloc(1024);
                fns.error(handle, buf, buf.length);
                throw new Error(message(buf));
            }
            const outputs = [];
            for (let index = 0; index < fns.outputCount(handle); index += 1) {
                const dims = shapeOf(fns.outputShape, index);
                const data = new Float32Array(dims.reduce((a, b) => a * b, 1));
                fns.output(handle, index, data, data.length);
                outputs.push({ data, dims });
            }
            fns.clear(handle);
            return outputs;
        },
        /** Frees the model and every buffer it holds. The handle is dead afterwards. */
        release: () => {
            if (!live) return;
            live = false;
            fns.free(handle);
        },
    };
};

module.exports = { loadModel, loadBeatThis, loadHtdemucs, isa, preferFastCores, libraryPath, LIBRARY_FILE };
