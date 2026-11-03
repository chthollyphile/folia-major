import { HTDEMUCS_GPU_SEGMENT } from './beatThisGpu';
import { runStemPass, type StemReader } from './stemPass';
import { stemSegmentStarts, stemSegmentWindow } from './stemRange';

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
//
// The running sum is also what a stopped separation resumes from (analysis service plan, 2b): with
// `progress`, the sum, the next segment and how far it is divided live in the caller's object (the
// weight is worked out at each sample, stemPass.ts), so a separation stopped at a segment boundary can
// be handed back what it had - only the part not yet final matters, the next segment's quarter - and
// carry on from that segment. The stem is then the same, bit for bit, as one separated in a single go.
//
// The loop itself is stemPass.ts' since the stem-pass refactor: the drums are one reader on a pass
// that can carry the other stems' readers too. Since the analysis service's phase 3 the grid, the
// window and the segments themselves are stemRange.ts': with the track's `key`, a segment automix
// already separated (the track's head, while the one before played) is taken from there rather than
// run again, and one automix said it wants (the track's tail) is kept for it.

/** The triangular overlap-add window of htdemucs.cjs `buildWindow`, for one segment. */
export const drumStemWindow = (segment: number): Float32Array => stemSegmentWindow(segment);

/** Where each segment starts, for a track of `total` samples: a step of three quarters of a segment. */
export const drumStemSegments = (total: number, segment = HTDEMUCS_GPU_SEGMENT): number[] => stemSegmentStarts(total, segment);

/** Where a drum separation is: the stem (a running sum past `divided`), the next segment, and how far it is final. */
export interface DrumStemProgress {
    drums: Float32Array;
    /** The index of the next segment to separate. */
    next: number;
    /** Samples from the start whose quotient is final (divided). */
    divided: number;
}

/** A fresh progress for a track of `total` samples. */
export const startDrumStem = (total: number): DrumStemProgress => ({
    drums: new Float32Array(total),
    next: 0,
    divided: 0,
});

/**
 * The drum stem of a stereo track at 44.1 kHz, as mono (the two channels averaged), or null when any
 * segment cannot be separated now, or as soon as `keepGoing` answers false (asked before each one).
 * `onSegment` hears each finished segment's index and the count, and the stem so far: `drums` is final
 * up to `final` samples (the rest of it is not yet divided, and is not to be read). One drum reader on
 * a stem pass (stemPass.ts), its window the whole of `progress.drums`.
 */
export const separateDrumStem = async (
    left: Float32Array,
    right: Float32Array,
    onSegment?: (done: number, count: number, drums: Float32Array, final: number) => void,
    keepGoing: () => boolean = () => true,
    progress: DrumStemProgress = startDrumStem(left.length),
    /** The track's analysis key: segments shared with automix through stemRange.ts. */
    key?: string,
): Promise<Float32Array | null> => {
    const count = drumStemSegments(left.length).length;
    const reader: StemReader = {
        source: 'drums',
        next: progress.next,
        divided: progress.divided,
        window: { samples: progress.drums, base: 0 },
        read: (final) => {
            progress.next = reader.next;
            progress.divided = final;
            onSegment?.(reader.next, count, progress.drums, final);
            // The whole stem stays: the caller reads it as it likes.
            return 0;
        },
    };
    const done = await runStemPass({ left, right, readers: () => [reader], keepGoing, key });
    return done ? progress.drums : null;
};
