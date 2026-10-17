// electron/analysis/htdemucs.cjs
// htdemucs separation around a loaded model: the segmenting, the overlap-add window and the stem
// order. Raw stereo at 44.1kHz in, three stereo stems out.
//
// This was htdemucs_runner.py, in a downloaded Python beside the app, for one onnxruntime flag only
// its Python binding exposed. On MNN that reason is gone and so is the process: the model runs in
// worker.cjs' own utilityProcess (mnn.cjs) and this file is the part of the runner that was not the
// model. The constants are still the reference implementation's (demucs_onnx 0.3.4,
// `_chunked_separate_single`), carried over unchanged.
//
// The model takes the raw mix - its STFT and iSTFT are inside the graph again, as matrix products
// (build/htdemucs_mnn/make_model.py), so nothing here does any DSP beyond the window.

/** The model's own row order. */
const SOURCES = ['drums', 'bass', 'other', 'vocals'];
/** What we hand back - 'other' dropped. The renderer reads them by name. */
const RETURNED = ['drums', 'bass', 'vocals'];

/**
 * The reference's triangular overlap-add window: chunks step by 3/4 of a segment, each faded across
 * the quarter it shares with its neighbour, and the sum divided by total weight. A chunk boundary
 * without it is an audible seam.
 */
const buildWindow = (segment) => {
    const overlap = Math.floor(segment / 4);
    const win = new Float32Array(segment).fill(1);
    for (let i = 0; i < overlap; i += 1) {
        const ramp = i / (overlap - 1);
        win[i] = ramp;
        win[segment - 1 - i] = ramp;
    }
    return win;
};

/**
 * Separates one stereo buffer with `model` (mnn.cjs loadModel). Resolves `{ drums, bass, vocals }`,
 * each `{ left, right }` Float32Array the length of the input.
 *
 * The segment is asked of the model rather than repeated here: the length is welded into the graph -
 * the shapes, the position tables and the overlap-add normaliser are each cut for one window - so a
 * constant beside it would only be a second answer, and the two disagreeing is wrong audio, not a crash.
 */
const separate = async (model, left, right) => {
    const total = left.length;
    const segment = model.inputShape(0)[2];
    if (!(segment > 0)) throw new Error(`the model's input is not [1, 2, segment]: [${model.inputShape(0)}]`);
    const win = buildWindow(segment);
    const stride = segment - Math.floor(segment / 4);
    const chunks = Math.max(1, Math.ceil(total / stride));

    const out = SOURCES.map(() => [new Float32Array(total), new Float32Array(total)]);
    const weight = new Float32Array(total);
    const input = new Float32Array(2 * segment);

    for (let c = 0; c < chunks; c += 1) {
        const start = c * stride;
        const end = Math.min(start + segment, total);
        if (end <= start) break;
        const n = end - start;
        input.fill(0);
        input.set(left.subarray(start, end), 0);
        input.set(right.subarray(start, end), segment);
        const [{ data: stems }] = await model.run([{ data: input, dims: [1, 2, segment] }]);   // [1, 4, 2, segment]
        for (let s = 0; s < SOURCES.length; s += 1) {
            for (let ch = 0; ch < 2; ch += 1) {
                const from = (s * 2 + ch) * segment;
                const to = out[s][ch];
                for (let i = 0; i < n; i += 1) to[start + i] += stems[from + i] * win[i];
            }
        }
        for (let i = 0; i < n; i += 1) weight[start + i] += win[i];
    }

    for (let i = 0; i < total; i += 1) weight[i] = Math.max(weight[i], 1e-8);
    const reply = {};
    for (const name of RETURNED) {
        const [l, r] = out[SOURCES.indexOf(name)];
        for (let i = 0; i < total; i += 1) {
            l[i] /= weight[i];
            r[i] /= weight[i];
        }
        reply[name] = { left: l, right: r };
    }
    return reply;
};

module.exports = { separate, buildWindow, SOURCES, RETURNED };
