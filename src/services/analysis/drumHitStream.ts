import { BEAT_THIS_FPS, type MelSpectrogram } from './beatThis';

// src/services/analysis/drumHitStream.ts
// The drum stem's three hit bands (kick, snare, hats; drumHits.ts `drumBandTracks`) read while the
// stem is still separating, so 时计 has hits seconds into a track instead of after the whole of it.
// drumStem.ts hands over the stem's finished head after every segment; this turns each new stretch of
// it into spectrogram frames and appends them, and drumHits.ts picks hits over the frames so far.
//
// The frames are the whole-track pipeline's (resampled to 22.05 kHz, then beat_this' spectrogram,
// centred, a frame every 882 samples at 44.1 kHz), computed a stretch at a time - not the whole head
// again each segment, which would be hours of audio over a track. A stretch is cut at a frame
// boundary and read with MARGIN_FRAMES of the stem on either side, whose frames are thrown away: an
// STFT window or the resampler's filter reaching past a cut sees an edge that is not in the music,
// and the rise detection would read that step as a hit at every cut. Only the track's own ends are
// kept as they come, as the whole-track pipeline pads them the same way. Frames whose window reaches
// past the finished head wait for the next stretch.

/** The stem's rate: a spectrogram frame every STEM_RATE / BEAT_THIS_FPS (882) of its samples. */
const STEM_RATE = 44100;
/**
 * Frames read and thrown away on either side of a stretch (80 ms): more than the STFT's half window
 * (512 samples at 22.05 kHz, 23 ms) plus the resampler's filter.
 */
const MARGIN_FRAMES = 4;

export type DrumBands = [Float32Array, Float32Array, Float32Array];

export interface DrumBandStreamSteps {
    /** 44.1 kHz mono to 22.05 kHz. */
    resample: (signal: Float32Array) => Promise<Float32Array>;
    /** beat_this' spectrogram of 22.05 kHz mono. */
    mel: (mono: Float32Array) => Promise<MelSpectrogram>;
    /** A spectrogram's three bands per frame. */
    bands: (mel: MelSpectrogram) => DrumBands;
}

export interface DrumBandStream {
    /** The whole track's frame count: the same as one spectrogram of the whole stem. */
    readonly frames: number;
    /** The three bands of every frame; final up to `done`. */
    readonly bands: DrumBands;
    /** How many frames from the start are final. */
    readonly done: number;
    /**
     * Reads the frames that `drums`' first `final` samples settle (all of them at `end`). One call at a
     * time: the caller waits for each before the next.
     */
    advance: (drums: Float32Array, final: number, end: boolean) => Promise<void>;
}

export const createDrumBandStream = (total: number, steps: DrumBandStreamSteps): DrumBandStream => {
    const frameSamples = STEM_RATE / BEAT_THIS_FPS;
    // One spectrogram of the whole resampled stem would have this many frames (beatThis.ts).
    const frames = Math.floor(Math.ceil(total / 2) / (frameSamples / 2)) + 1;
    const bands: DrumBands = [new Float32Array(frames), new Float32Array(frames), new Float32Array(frames)];
    let done = 0;
    return {
        frames,
        bands,
        get done() {
            return done;
        },
        advance: async (drums, final, end) => {
            // The last frame whose margin still lies inside the finished head.
            const target = end ? frames : Math.min(frames, Math.floor(final / frameSamples) - MARGIN_FRAMES + 1);
            if (target <= done) return;
            const first = Math.max(0, done - MARGIN_FRAMES);
            const from = first * frameSamples;
            const to = end ? total : (target - 1 + MARGIN_FRAMES) * frameSamples;
            const read = steps.bands(await steps.mel(await steps.resample(drums.subarray(from, to))));
            for (let frame = done; frame < target; frame += 1) {
                const at = frame - first;
                for (let band = 0; band < 3; band += 1) bands[band][frame] = read[band][at] ?? 0;
            }
            done = target;
        },
    };
};
