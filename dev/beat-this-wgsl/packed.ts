import type { BeatThisWgslManifest } from '../../src/services/analysis/beatThisWgsl/runtime';

// dev/beat-this-wgsl/packed.ts
// The test shell's reader for the packed export (tensors, manifest JSON, b'FOLIABTW' + uint64 LE JSON
// offset) - the same layout electron/analysis/packedWeights.cjs reads for the app, repeated here so the
// shell's bundles need nothing from electron/.

export const readPackedWeights = (file: Uint8Array): { weights: Uint8Array; manifest: BeatThisWgslManifest } => {
    const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
    const tail = file.byteLength - 16;
    if (new TextDecoder().decode(file.subarray(tail, tail + 8)) !== 'FOLIABTW') throw new Error('not a packed beat_this export');
    const at = Number(view.getBigUint64(tail + 8, true));
    const manifest = JSON.parse(new TextDecoder().decode(file.subarray(at, tail))) as BeatThisWgslManifest;
    return { weights: file.subarray(0, at), manifest };
};
