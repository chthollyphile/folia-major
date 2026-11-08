import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/db', () => ({ getFromCache: vi.fn(async () => null), saveToCache: vi.fn(async () => undefined) }));

const { BEAT_THIS_FPS, melSpectrogram } = await import('@/services/analysis/beatThis');
const { rememberVocalEnvelope, VOCAL_FPS, vocalEnvelopeOf, vocalLevels } = await import('@/services/analysis/vocalEnvelope');
const { saveToCache } = await import('@/services/db');

// test/unit/analysis/vocalEnvelope.test.ts
// 人声包络的纯函数：逐帧响度、top、起音，用合成的「唱几声」信号验证。

const RATE = 44100;

/** 一段 44.1 kHz 的信号：每个 [起点秒, 长度秒] 一个带泛音的 220 Hz 音（10 毫秒渐入渐出），其余是很轻的噪声。 */
const sing = (seconds: number, notes: [number, number][]) => {
    const out = new Float32Array(seconds * RATE);
    let seed = 1;
    for (let i = 0; i < out.length; i += 1) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        out[i] = ((seed / 2 ** 32) - 0.5) * 1e-4;
    }
    for (const [from, length] of notes) {
        for (let i = Math.round(from * RATE); i < Math.min(out.length, Math.round((from + length) * RATE)); i += 1) {
            const t = i / RATE;
            // Faded in and out over 10 ms, as a voice is: a hard cut would read as a click.
            const fade = Math.min(1, (t - from) / 0.01, (from + length - t) / 0.01);
            out[i] += fade * (0.3 * Math.sin(2 * Math.PI * 220 * t) + 0.1 * Math.sin(2 * Math.PI * 660 * t));
        }
    }
    return out;
};

const down = (stem: Float32Array) => Float32Array.from({ length: stem.length / 2 }, (_, i) => stem[2 * i]);

describe('vocalEnvelope', () => {
    it('runs at the frame rate of the spectrogram it reads', () => {
        expect(VOCAL_FPS).toBe(BEAT_THIS_FPS);
    });

    it('reads the RMS level over 40 ms around each 20 ms frame', () => {
        const stem = new Float32Array(RATE).fill(0.5);
        const db = vocalLevels(stem);
        expect(db.length).toBe(50);
        // 0.5 RMS = -6.02 dB, away from the edges where the window hangs over the ends.
        expect(db[25]).toBeCloseTo(20 * Math.log10(0.5), 2);
        expect(db[0]).toBeLessThan(db[25]);
    });

    it('finds an onset at each sung note, and none in the silence', async () => {
        const starts = [1, 2.2, 3.1, 4.6, 6];
        const stem = sing(8, starts.map(from => [from, 0.6]));
        const env = vocalEnvelopeOf(stem, await melSpectrogram(down(stem)));
        expect(env.fps).toBe(VOCAL_FPS);
        expect(env.top).toBeGreaterThan(-20);
        const onsets = Array.from(env.onsets, frame => frame / env.fps);
        for (const from of starts) expect(onsets.some(at => Math.abs(at - from) <= 0.06)).toBe(true);
        expect(onsets.every(at => starts.some(from => Math.abs(at - from) <= 0.06))).toBe(true);
    });

    it('reads an envelope starting part way from where the stem is whole, and keeps it unstored', async () => {
        const starts = [1, 2.2, 3.1, 4.6, 6];
        const stem = sing(8, starts.map(from => [from, 0.6]));
        // Separated from 2.5 s on: the note at 2.2 s cut there, a step from silence.
        stem.fill(0, 0, 2.5 * RATE);
        const env = vocalEnvelopeOf(stem, await melSpectrogram(down(stem)), 2.5 * RATE);
        expect(env.from! / env.fps).toBeGreaterThanOrEqual(2.5);
        expect(env.from! / env.fps).toBeLessThan(2.6);
        expect(env.db.subarray(0, env.from).every(db => db === -120)).toBe(true);
        expect(env.top).toBeGreaterThan(-20);
        const onsets = Array.from(env.onsets, frame => frame / env.fps);
        for (const from of [3.1, 4.6, 6]) expect(onsets.some(at => Math.abs(at - from) <= 0.06)).toBe(true);
        expect(onsets.every(at => [3.1, 4.6, 6].some(from => Math.abs(at - from) <= 0.06))).toBe(true);
        await rememberVocalEnvelope('part', env);
        expect(saveToCache).not.toHaveBeenCalled();
    });
});
