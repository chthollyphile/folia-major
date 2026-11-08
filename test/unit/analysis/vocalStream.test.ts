import { describe, expect, it, vi } from 'vitest';

// test/unit/analysis/vocalStream.test.ts
// 雾笺's vocal envelope read a stretch at a time as the stem is finished (analysis/vocalStream.ts): the
// same as one read off the whole stem, from the start or from part way.

vi.mock('@/services/db', () => ({ getFromCache: vi.fn(async () => null), saveToCache: vi.fn(async () => undefined) }));

const { melSpectrogram } = await import('@/services/analysis/beatThis');
const { vocalEnvelopeOf } = await import('@/services/analysis/vocalEnvelope');
const { createVocalStream } = await import('@/services/analysis/vocalStream');

const RATE = 44100;
/** The browser's resampler stood in for by taking every other sample, as in drumHitsVocals.test.ts. */
const resample = async (signal: Float32Array) => signal.filter((_, at) => at % 2 === 0);
const steps = { resample, mel: melSpectrogram };

/** Notes every 0.8 s, faded over 10 ms, over faint noise. */
const sing = (seconds: number) => {
    const out = new Float32Array(seconds * RATE);
    let seed = 7;
    for (let at = 0; at < out.length; at += 1) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const t = at / RATE, inNote = t % 0.8;
        const fade = Math.min(1, inNote / 0.01, Math.max(0, 0.5 - inNote) / 0.01);
        out[at] = ((seed / 2 ** 32) - 0.5) * 1e-4 + fade * 0.3 * Math.sin(2 * Math.PI * 220 * t);
    }
    return out;
};

/** Hands the stem over the way a separation finishes it: every 0.75 s, the window all of it. */
const stream = async (stem: Float32Array, wholeFrom: number) => {
    const reader = createVocalStream(stem.length, steps, wholeFrom);
    const window = { samples: stem, base: 0 };
    const step = Math.round(0.75 * RATE);
    for (let final = Math.max(step, wholeFrom + step); final < stem.length; final += step) await reader.advance(window, final, false);
    await reader.advance(window, stem.length, true);
    return reader.envelope();
};

describe('vocal stream', () => {
    it('reads the same envelope a stretch at a time as off the whole stem', async () => {
        const stem = sing(12);
        const whole = vocalEnvelopeOf(stem, await melSpectrogram(await resample(stem)));
        const streamed = await stream(stem, 0);
        expect(Array.from(streamed.db)).toEqual(Array.from(whole.db));
        expect(streamed.top).toBe(whole.top);
        expect(Array.from(streamed.onsets)).toEqual(Array.from(whole.onsets));
        expect(streamed.onsets.length).toBeGreaterThanOrEqual(14);
    });

    it('reads one starting part way from where the stem is whole, without the step into it', async () => {
        const stem = sing(12);
        const wholeFrom = Math.round(4.3 * RATE);
        stem.fill(0, 0, wholeFrom);
        const streamed = await stream(stem, wholeFrom);
        expect(streamed.from! / streamed.fps).toBeGreaterThan(4.3);
        expect(streamed.from! / streamed.fps).toBeLessThan(4.5);
        const onsets = Array.from(streamed.onsets, frame => frame / streamed.fps);
        expect(onsets.every(at => at > 4.3 && Math.min(at % 0.8, 0.8 - (at % 0.8)) <= 0.06)).toBe(true);
        expect(onsets.length).toBeGreaterThanOrEqual(8);
    });
});
