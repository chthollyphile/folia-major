// src/services/analysis/strokesWgsl/packed.ts
// The stroke-order models' weights (full6, own1: ~/bihua tools/infer/export_folia.py, the FOLIABTW
// file htdemucs-wgsl.bin also uses) read and repacked into the one GPU buffer the WGSL runtime binds.
//
// The file stores every matrix as written by the export (Linear [out, in], conv [cout, cin*kh*kw], q / k / v
// apart), each at its own 256-byte aligned offset. A decode step wants a few of them side by side - one
// GEMM for q|k|v, one for the cross-attention k|v, one for coarse.0|pt_in - so `repack` builds a fresh
// buffer of named entries, each a tensor or a concatenation of tensors along their first axis, kept in the
// dtype the file has (fp16 matrices stay fp16, biases / norms / tables f32). Kernels then index it by
// word offset (`PackedEntry.word`) from their uniforms: one binding for all weights.
//
// Plain functions, no WebGPU: unit-tested under node (test/unit/strokesWgsl/packed.test.ts).

export interface StrokesManifestTensor {
    byte_offset: number;
    shape: number[];
    dtype: 'f32' | 'f16';
    conv?: { cin: number; k: [number, number]; stride: [number, number]; pad: [number, number] };
}

export interface StrokesManifest {
    /** 'strokenet-full6' or 'strokenet-own1'. */
    model: string;
    hyper_parameters: Record<string, unknown>;
    notes?: Record<string, string>;
    tensors: Record<string, StrokesManifestTensor>;
    bytes: number;
}

const MAGIC = 'FOLIABTW';
const TRAILER = MAGIC.length + 8;

/** `{ weights, manifest }` of a whole FOLIABTW file (no copy: `weights` views the tensor region). Throws on a malformed file. */
export const unpackStrokes = (file: Uint8Array): { weights: Uint8Array; manifest: StrokesManifest } => {
    if (file.byteLength < TRAILER) throw new Error('not a packed export (shorter than its trailer)');
    const tail = file.byteLength - TRAILER;
    if (new TextDecoder().decode(file.subarray(tail, tail + MAGIC.length)) !== MAGIC) throw new Error('not a packed export (no FOLIABTW trailer)');
    const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
    const at = Number(view.getBigUint64(tail + MAGIC.length, true));
    if (!(at > 0 && at < tail)) throw new Error(`manifest offset ${at} is outside the file`);
    const manifest = JSON.parse(new TextDecoder().decode(file.subarray(at, tail))) as StrokesManifest;
    if (manifest.bytes !== at) throw new Error(`the tensors are ${at} bytes, the manifest says ${manifest.bytes}`);
    return { weights: file.subarray(0, at), manifest };
};

export interface PackedEntry {
    /** Offset into the packed buffer in 32-bit words (f16 entries: element 0 is the low half of this word). */
    word: number;
    shape: number[];
    dtype: 'f32' | 'f16';
}

export interface PackedWeights {
    /** The buffer to upload, a multiple of 16 bytes. */
    data: Uint8Array;
    entries: Record<string, PackedEntry>;
}

const product = (shape: number[]) => shape.reduce((a, b) => a * b, 1);

/**
 * A packed buffer of named entries: `spec[name]` is one tensor name or several, concatenated along
 * axis 0 (same dtype and trailing shape). Every entry starts on a 16-byte boundary.
 */
export const repack = (weights: Uint8Array, manifest: StrokesManifest, spec: Record<string, string | string[]>): PackedWeights => {
    const plan: { name: string; parts: StrokesManifestTensor[]; shape: number[]; dtype: 'f32' | 'f16'; bytes: number }[] = [];
    let total = 0;
    for (const [name, source] of Object.entries(spec)) {
        const names = typeof source === 'string' ? [source] : source;
        const parts = names.map((n) => {
            const found = manifest.tensors[n];
            if (!found) throw new Error(`${manifest.model}: missing tensor ${n}`);
            return found;
        });
        const { dtype } = parts[0];
        const rest = parts[0].shape.slice(1).join(',');
        for (const [i, part] of parts.entries()) {
            if (part.dtype !== dtype || part.shape.slice(1).join(',') !== rest) throw new Error(`${name}: ${names[i]} does not stack with ${names[0]}`);
        }
        const shape = [parts.reduce((sum, part) => sum + part.shape[0], 0), ...parts[0].shape.slice(1)];
        const bytes = product(shape) * (dtype === 'f16' ? 2 : 4);
        plan.push({ name, parts, shape, dtype, bytes });
        total += Math.ceil(bytes / 16) * 16;
    }
    const data = new Uint8Array(Math.max(16, total));
    const entries: Record<string, PackedEntry> = {};
    let at = 0;
    for (const { name, parts, shape, dtype, bytes } of plan) {
        entries[name] = { word: at / 4, shape, dtype };
        let to = at;
        for (const part of parts) {
            const n = product(part.shape) * (dtype === 'f16' ? 2 : 4);
            if (part.byte_offset + n > weights.byteLength) throw new Error(`${name}: tensor runs past the file`);
            data.set(weights.subarray(part.byte_offset, part.byte_offset + n), to);
            to += n;
        }
        at += Math.ceil(bytes / 16) * 16;
    }
    return { data, entries };
};

/** f16 bits -> number (for host-side tables and tests). */
export const halfToFloat = (h: number): number => {
    const sign = h & 0x8000 ? -1 : 1;
    const exp = (h >> 10) & 0x1f;
    const man = h & 0x3ff;
    if (exp === 0) return sign * man * 2 ** -24;
    if (exp === 31) return man ? NaN : sign * Infinity;
    return sign * (1 + man / 1024) * 2 ** (exp - 15);
};

/** One tensor of the file as f32 values (f16 unpacked). */
export const readTensor = (weights: Uint8Array, manifest: StrokesManifest, name: string): Float32Array => {
    const entry = manifest.tensors[name];
    if (!entry) throw new Error(`${manifest.model}: missing tensor ${name}`);
    const n = product(entry.shape);
    const out = new Float32Array(n);
    const view = new DataView(weights.buffer, weights.byteOffset + entry.byte_offset, n * (entry.dtype === 'f16' ? 2 : 4));
    for (let i = 0; i < n; i += 1) out[i] = entry.dtype === 'f16' ? halfToFloat(view.getUint16(i * 2, true)) : view.getFloat32(i * 4, true);
    return out;
};
