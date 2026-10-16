const fs = require('fs');
const path = require('path');
const { unpackWeights } = require('./packedWeights.cjs');

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
const ABI = 1;

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
 * @param file the export's bytes, whole
 */
const loadBeatThis = (file, { threads = 4 } = {}) => {
    const { weights: bin, manifest } = unpackWeights(file);
    const fns = bind();
    const set = fns.btCreate();
    try {
        for (const [name, entry] of Object.entries(manifest.tensors)) {
            const shape = Int32Array.from(entry.shape);
            const at = bin.byteOffset + entry.byte_offset;
            if (fns.btPut(set, name, new Uint8Array(bin.buffer, at, bin.byteLength - entry.byte_offset), entry.dtype === 'f16' ? 1 : 0,
                shape, shape.length, entry.stride ?? 0) !== 0) {
                throw new Error(`beat_this tensor ${name} [${entry.shape}] was refused`);
            }
        }
        const err = Buffer.alloc(1024);
        const handle = fns.btBuild(set, threads, err, err.length);
        if (!handle) throw new Error(message(err));
        return wrap(fns, handle);
    } finally {
        fns.btFree(set);
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

module.exports = { loadModel, loadBeatThis, isa, preferFastCores, libraryPath, LIBRARY_FILE };
