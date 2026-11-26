import { describe, expect, it } from 'vitest';
import { halfToFloat, readTensor, repack, unpackStrokes, type StrokesManifest } from '@/services/analysis/strokesWgsl/packed';

// test/unit/strokesWgsl/packed.test.ts
// The stroke-order weights' FOLIABTW reader and repacker (src/services/analysis/strokesWgsl/packed.ts) on a
// hand-built file: trailer / manifest checks, concatenation along axis 0, 16-byte entry alignment, f16 bits.

/** A FOLIABTW file: tensor bytes, then the manifest JSON, then 'FOLIABTW' + the manifest's u64 offset. */
const buildFile = (tensors: Record<string, { shape: number[]; dtype: 'f32' | 'f16'; values: number[] }>) => {
    const chunks: Uint8Array[] = [];
    const entries: StrokesManifest['tensors'] = {};
    let at = 0;
    for (const [name, tensor] of Object.entries(tensors)) {
        const bytes = tensor.dtype === 'f32' ? new Uint8Array(Float32Array.from(tensor.values).buffer) : new Uint8Array(Uint16Array.from(tensor.values).buffer);
        const padded = new Uint8Array(Math.ceil(bytes.byteLength / 256) * 256);
        padded.set(bytes);
        entries[name] = { byte_offset: at, shape: tensor.shape, dtype: tensor.dtype };
        chunks.push(padded);
        at += padded.byteLength;
    }
    const manifest: StrokesManifest = { model: 'strokenet-test', hyper_parameters: {}, tensors: entries, bytes: at };
    const json = new TextEncoder().encode(JSON.stringify(manifest));
    const trailer = new Uint8Array(16);
    trailer.set(new TextEncoder().encode('FOLIABTW'));
    new DataView(trailer.buffer).setBigUint64(8, BigInt(at), true);
    const file = new Uint8Array(at + json.byteLength + 16);
    let to = 0;
    for (const chunk of [...chunks, json, trailer]) { file.set(chunk, to); to += chunk.byteLength; }
    return file;
};

const file = buildFile({
    'q.w': { shape: [2, 3], dtype: 'f32', values: [1, 2, 3, 4, 5, 6] },
    'k.w': { shape: [1, 3], dtype: 'f32', values: [7, 8, 9] },
    'h.w': { shape: [3], dtype: 'f16', values: [0x3c00, 0xc000, 0x3800] },
    'bad.w': { shape: [1, 2], dtype: 'f32', values: [0, 0] },
});

describe('unpackStrokes', () => {
    it('reads the manifest and views the tensor region', () => {
        const { weights, manifest } = unpackStrokes(file);
        expect(manifest.model).toBe('strokenet-test');
        expect(weights.byteLength).toBe(manifest.bytes);
        expect(Array.from(readTensor(weights, manifest, 'k.w'))).toEqual([7, 8, 9]);
        expect(Array.from(readTensor(weights, manifest, 'h.w'))).toEqual([1, -2, 0.5]);
    });

    it('rejects a file without the trailer', () => {
        expect(() => unpackStrokes(file.subarray(0, file.byteLength - 1))).toThrow(/FOLIABTW/);
        expect(() => unpackStrokes(new Uint8Array(4))).toThrow(/trailer/);
    });
});

describe('repack', () => {
    const { weights, manifest } = unpackStrokes(file);

    it('concatenates along axis 0 and aligns every entry to 16 bytes', () => {
        const packed = repack(weights, manifest, { qk: ['q.w', 'k.w'], h: 'h.w' });
        expect(packed.entries.qk).toEqual({ word: 0, shape: [3, 3], dtype: 'f32' });
        expect(packed.entries.h.word).toBe(12);
        expect(packed.data.byteLength % 16).toBe(0);
        expect(Array.from(new Float32Array(packed.data.buffer, 0, 9))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        expect(Array.from(new Uint16Array(packed.data.buffer, 48, 3))).toEqual([0x3c00, 0xc000, 0x3800]);
    });

    it('refuses tensors that do not stack, and missing names', () => {
        expect(() => repack(weights, manifest, { x: ['q.w', 'bad.w'] })).toThrow(/does not stack/);
        expect(() => repack(weights, manifest, { x: 'nope' })).toThrow(/missing tensor nope/);
    });
});

describe('halfToFloat', () => {
    it('decodes normals, subnormals and specials', () => {
        expect(halfToFloat(0x3c00)).toBe(1);
        expect(halfToFloat(0x7bff)).toBe(65504);
        expect(halfToFloat(0x0001)).toBe(2 ** -24);
        expect(halfToFloat(0xfc00)).toBe(-Infinity);
        expect(halfToFloat(0x7e00)).toBeNaN();
    });
});
