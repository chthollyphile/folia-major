import { HTDEMUCS_GPU_SEGMENT, runHtdemucsGpu } from './beatThisGpu';

// src/services/analysis/drumStem.ts
// A whole track's drum stem from htdemucs on the renderer's GPU (beatThisGpu.ts runHtdemucsGpu, the
// WGSL runtime in htdemucsWgsl/): the track cut into the model's 3.9 s segments, each separated on
// its own, and the segments laid back together. The cutting and the joining are the reference
// implementation's (demucs `_chunked_separate_single`), the same as the CPU path's
// electron/analysis/htdemucs.cjs: segments step by three quarters of their length, each faded in and
// out across the quarter it shares with a neighbour by a triangular window, and the sum divided by
// the total weight - a boundary without it is an audible seam, and a step in the drum envelope that
// the hit picking would read as a hit.
//
// GPU only: there is no CPU path behind this (智能动感模式 does not run htdemucs on the CPU). Null as
// soon as one segment comes back without a stem - htdemucs_gpu not installed, no usable WebGPU, a
// failed run - and the caller keeps the beats it had. Null too once `keepGoing` says no: a track
// skipped mid-separation stops at its next segment rather than holding the GPU for the rest of it.
//
// The sum and the weight are what online softmax keeps: a running numerator and denominator, the
// quotient read whenever wanted. Once a segment is in, every sample before the next segment's start
// has had every contribution it will get, so its quotient is final - divided there and then, and
// handed to `onSegment` as the stem's finished head, for a caller that reads hits while the rest is
// still separating (drumHitStream.ts). Each sample is divided once, so the stem is the same either way.

/** The triangular overlap-add window of htdemucs.cjs `buildWindow`, for one segment. */
export const drumStemWindow = (segment: number): Float32Array => {
    const overlap = Math.floor(segment / 4);
    const win = new Float32Array(segment).fill(1);
    for (let i = 0; i < overlap; i += 1) {
        const ramp = i / (overlap - 1);
        win[i] = ramp;
        win[segment - 1 - i] = ramp;
    }
    return win;
};

/** Where each segment starts, for a track of `total` samples: a step of three quarters of a segment. */
export const drumStemSegments = (total: number, segment = HTDEMUCS_GPU_SEGMENT): number[] => {
    const stride = segment - Math.floor(segment / 4);
    const count = Math.max(1, Math.ceil(total / stride));
    const starts: number[] = [];
    for (let c = 0; c < count; c += 1) {
        const start = c * stride;
        if (start >= total && c > 0) break;
        starts.push(start);
    }
    return starts;
};

/**
 * The drum stem of a stereo track at 44.1 kHz, as mono (the two channels averaged), or null when any
 * segment cannot be separated now, or as soon as `keepGoing` answers false (asked before each one).
 * `onSegment` hears each finished segment's index and the count, and the stem so far: `drums` is final
 * up to `final` samples (the rest of it is not yet divided, and is not to be read).
 */
export const separateDrumStem = async (
    left: Float32Array,
    right: Float32Array,
    onSegment?: (done: number, count: number, drums: Float32Array, final: number) => void,
    keepGoing: () => boolean = () => true,
): Promise<Float32Array | null> => {
    const segment = HTDEMUCS_GPU_SEGMENT;
    const total = left.length;
    const win = drumStemWindow(segment);
    const starts = drumStemSegments(total, segment);
    const drums = new Float32Array(total);
    const weight = new Float32Array(total);
    const inLeft = new Float32Array(segment);
    const inRight = new Float32Array(segment);
    let divided = 0;
    for (const [index, start] of starts.entries()) {
        if (!keepGoing()) return null;
        const n = Math.min(segment, total - start);
        // The last segment runs past the end of the track: zeros, as the reference pads it.
        inLeft.fill(0);
        inRight.fill(0);
        inLeft.set(left.subarray(start, start + n));
        inRight.set(right.subarray(start, start + n));
        const stem = await runHtdemucsGpu(inLeft, inRight);
        if (!stem) return null;
        for (let i = 0; i < n; i += 1) {
            drums[start + i] += ((stem.left[i] + stem.right[i]) / 2) * win[i];
            weight[start + i] += win[i];
        }
        // Up to where the next segment starts, nothing more will be added.
        const final = index + 1 < starts.length ? starts[index + 1] : total;
        for (let i = divided; i < final; i += 1) drums[i] /= Math.max(weight[i], 1e-8);
        divided = final;
        onSegment?.(index + 1, starts.length, drums, final);
    }
    return drums;
};
