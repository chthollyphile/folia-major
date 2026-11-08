import { MEL_BANDS, type MelSpectrogram } from './beatThis';
import type { StemWindow } from './stemPass';
import { fluxBetween, VOCAL_FPS, vocalEnvelopeOfFeatures, type VocalEnvelope } from './vocalEnvelope';

// src/services/analysis/vocalStream.ts
// 雾笺's vocal envelope read while the vocal stem is still separating, so the stem itself is never held
// whole (stemPass.ts' moving StemWindow): each finished stretch becomes its frames' two features - the
// level (`db`, vocalEnvelope.ts' vocalLevels) and the spectral flux - and its samples are let go. The
// envelope is made of those once the last stretch is in; `top` and the flux's spread are read over
// the whole of them, so it is the envelope of the whole stem.
//
// A stretch is read the way drumHitStream.ts reads the drum stem's: cut at a frame boundary, with
// MARGIN_FRAMES of the stem on either side whose frames are thrown away, frames whose window reaches
// past what is final waiting for the next one. The flux of a stretch's first frame is taken against
// the last frame of the one before (kept, MEL_BANDS numbers), not a margin frame. A stem whole only
// from part way (`wholeFrom`, the vocals started at the playhead) is read from MARGIN_FRAMES frames
// past it, so the first stretch's margin is whole too; that frame is the envelope's `from`.

/** The stem's rate: a frame every STEM_RATE / VOCAL_FPS (882) of its samples (VOCAL_FPS is beat_this' rate, spelled out). */
const STEM_RATE = 44100;
const FRAME = STEM_RATE / VOCAL_FPS;
/** Frames read and thrown away on either side of a stretch, as drumHitStream.ts' (80 ms). */
const MARGIN_FRAMES = 4;

/**
 * How far behind what is final a stream reads the stem again, at most: its frames stop MARGIN_FRAMES
 * short of `final`, and the next stretch reads MARGIN_FRAMES and a frame's level window before them.
 * The window keeps this much (stemPass.ts' movingStemWindow).
 */
export const VOCAL_STREAM_KEEP = (2 * MARGIN_FRAMES + 2) * FRAME;

export interface VocalStreamSteps {
    /** 44.1 kHz mono to 22.05 kHz. */
    resample: (signal: Float32Array) => Promise<Float32Array>;
    /** beat_this' spectrogram of 22.05 kHz mono. */
    mel: (mono: Float32Array) => Promise<MelSpectrogram>;
}

export interface VocalStream {
    /** Reads the frames the window's stem settles up to `final` (all of them at `end`); answers the first sample it reads again. */
    advance: (window: StemWindow, final: number, end: boolean) => Promise<number>;
    /** The envelope, once the last stretch is in. */
    envelope: () => VocalEnvelope;
}

export const createVocalStream = (total: number, steps: VocalStreamSteps, wholeFrom = 0): VocalStream => {
    // One spectrogram of the whole resampled stem would have this many frames (beatThis.ts).
    const frames = Math.floor(Math.ceil(total / 2) / (FRAME / 2)) + 1;
    const db = new Float32Array(frames);
    const flux = new Float32Array(frames);
    const first = wholeFrom > 0 ? Math.min(frames, Math.ceil(wholeFrom / FRAME) + MARGIN_FRAMES) : 0;
    let done = first;
    /** The spectrogram row of frame `done - 1`, for the next stretch's first flux. */
    let lastRow: Float32Array | null = null;
    const needsFrom = () => Math.max(0, done - MARGIN_FRAMES - 1) * FRAME;
    return {
        advance: async (window, final, end) => {
            // The last frame whose margin still lies inside what is final.
            const target = end ? frames : Math.min(frames, Math.floor(final / FRAME) - MARGIN_FRAMES + 1);
            if (target <= done) return needsFrom();
            const read = Math.max(0, done - MARGIN_FRAMES);
            const { samples, base } = window;
            const to = end ? total : (target - 1 + MARGIN_FRAMES) * FRAME;
            const mel = await steps.mel(await steps.resample(samples.subarray(read * FRAME - base, to - base)));
            for (let frame = done; frame < target; frame += 1) {
                // The level over 40 ms around the frame, as vocalLevels sums it.
                const from = frame * FRAME - FRAME;
                let sum = 0;
                for (let at = Math.max(0, from); at < Math.min(total, from + 2 * FRAME); at += 1) sum += samples[at - base] * samples[at - base];
                db[frame] = 10 * Math.log10(sum / (2 * FRAME) + 1e-12);
                const row = frame - read;
                if (row >= mel.frames) continue;
                if (frame === done) flux[frame] = lastRow ? fluxBetween(mel.data, row, lastRow, 0) : 0;
                else flux[frame] = fluxBetween(mel.data, row, mel.data, row - 1);
            }
            const lastAt = Math.min(target - 1 - read, mel.frames - 1);
            lastRow = mel.data.slice(lastAt * MEL_BANDS, (lastAt + 1) * MEL_BANDS);
            done = target;
            return needsFrom();
        },
        envelope: () => vocalEnvelopeOfFeatures(db, flux, first),
    };
};
