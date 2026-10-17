// electron/analysis/packedWeights.cjs
// Reads beat_this-wgsl.bin: the WebGPU export's tensors and their manifest in ONE file.
//
// One file because the two halves are only usable together - a manifest from one export over another's
// tensors reads every tensor at the wrong offset, and nothing downstream would notice - and because a
// model is one download, one hash and one row in shared/modelManifest.json. Both runtimes read this same
// file: the renderer's WebGPU path (beatThisGpu.ts, through host.cjs) and the CPU fallback in worker.cjs
// (mnn.cjs loadBeatThis), so the fallback costs no second copy of the weights.
//
// Layout, written by build/beat_this_wgsl/export_weights.py:
//
//   [tensors: manifest.bytes][manifest JSON, UTF-8]["FOLIABTW"][uint64 LE: byte offset of the JSON]
//
// The tensors come first so every `byte_offset` in the manifest is an offset into the file itself.
// Plain node, no 'electron': both the main process and the analysis worker require it.

const MAGIC = 'FOLIABTW';
const TRAILER = MAGIC.length + 8;

/**
 * `{ weights, manifest }` from the file's bytes - `weights` a view of the tensor region, no copy - or
 * throws with what is wrong. The JSON's own `bytes` must equal where it starts: a file cut short, or
 * two exports glued together, fails here rather than as wrong beats.
 *
 * @param {Uint8Array} file the whole file
 */
const unpackWeights = (file) => {
    const bytes = file instanceof Uint8Array ? file : new Uint8Array(file);
    const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.byteLength < TRAILER || view.toString('latin1', view.byteLength - TRAILER, view.byteLength - 8) !== MAGIC) {
        throw new Error('not a packed beat_this export (no FOLIABTW trailer)');
    }
    const at = Number(view.readBigUInt64LE(view.byteLength - 8));
    if (!(at > 0 && at < view.byteLength - TRAILER)) throw new Error(`manifest offset ${at} is outside the file`);
    const manifest = JSON.parse(view.toString('utf8', at, view.byteLength - TRAILER));
    if (manifest.bytes !== at) throw new Error(`the tensors are ${at} bytes, the manifest says ${manifest.bytes}`);
    return { weights: bytes.subarray(0, at), manifest };
};

module.exports = { unpackWeights, MAGIC };
