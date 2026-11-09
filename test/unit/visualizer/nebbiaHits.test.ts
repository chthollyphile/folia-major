import { describe, expect, it } from 'vitest';
import { NebbiaHits, songLoudness, vocalEnvelopeEnergy } from '@/components/visualizer/nebbia/nebbiaHits';
import type { LaidLine } from '@/components/visualizer/nebbia/nebbiaScene';
import { VOCAL_FPS, type VocalEnvelope } from '@/services/analysis/vocalEnvelope';

// test/unit/visualizer/nebbiaHits.test.ts
// 雾笺的雨点跟 HTDemucs 人声轨走的那条路：大雨点砸在起音上、躲开正在唱的那句；小雨点在人声响的地方多，
// 同一首歌同一处每次一样。

const W = 1280;
const H = 720;

/** 10 秒：前 5 秒没唱（远低于 top − 28），后 5 秒在唱，响度起伏。 */
const envelope = (): VocalEnvelope => {
    const db = new Float32Array(10 * VOCAL_FPS).fill(-80);
    for (let frame = 5 * VOCAL_FPS; frame < db.length; frame += 1) db[frame] = -20 + 8 * Math.abs(Math.sin(frame * 0.37));
    return { fps: VOCAL_FPS, db, top: -14, onsets: Uint32Array.from([260, 300, 350, 400, 450]) };
};

/** 一句 5–8 秒的歌词，一个 200 像素见方的字在画面正中。 */
const line = { t: 5, end: 8, next: 9, chars: [{ x: 640, y: 360, s: 200, t: 5, glyph: {} }] } as unknown as LaidLine;

describe('nebbia rain on the vocal stem', () => {
    it('drops a big one on the onsets only, clear of the line being sung', () => {
        const hits = new NebbiaHits(7);
        hits.buildBig([line], [[[0]]], W, H, envelope());
        const { big } = hits.scheduled();
        expect(big.length).toBeGreaterThan(0);
        const onsetTimes = [260, 300, 350, 400, 450].map(frame => frame / VOCAL_FPS);
        for (const hit of big) {
            expect(onsetTimes).toContain(hit.t);
            const inside = hit.x > 540 - 20 && hit.x < 740 + 20 && hit.y > 260 - 20 && hit.y < 460 + 20;
            expect(inside).toBe(false);
        }
    });

    it('falls on word starts instead without the stem', () => {
        const hits = new NebbiaHits(7);
        hits.buildBig([line], [[[0]]], W, H);
        for (const hit of hits.scheduled().big) expect(hit.t).toBe(5);
    });

    it('drops the small ones where the voice is, the same each time', () => {
        const run = () => {
            const hits = new NebbiaHits(11);
            hits.buildBig([line], [[[0]]], W, H, envelope());
            for (let T = 0; T <= 10; T += 0.1) hits.advance(T, 0, 1, 100, W, H);
            return hits.scheduled().small.map(hit => [hit.t, hit.x, hit.y]);
        };
        const small = run();
        const quiet = small.filter(([t]) => t < 5).length;
        const sung = small.filter(([t]) => t >= 5).length;
        expect(sung).toBeGreaterThan(3 * Math.max(1, quiet));
        expect(run()).toEqual(small);
    });

    it('falls back to the band and the word starts before a stem separated part way', () => {
        // The stem from 7 s on: the line at 5 s gets its word-start drop, the onsets before 7 s none.
        const env = { ...envelope(), from: 7 * VOCAL_FPS };
        env.onsets = Uint32Array.from([380, 400, 450]);
        const hits = new NebbiaHits(7);
        hits.buildBig([line], [[[0]]], W, H, env);
        const times = hits.scheduled().big.map(hit => hit.t);
        expect(times.filter(t => t < 7).every(t => t === 5)).toBe(true);
        expect(times.filter(t => t >= 7).length).toBeGreaterThan(0);
        // Small drops: before 7 s from the band's energy (loud here), after it from the stem.
        for (let T = 0; T <= 10; T += 0.1) hits.advance(T, 1, 1, 100, W, H);
        const small = hits.scheduled().small;
        expect(small.filter(hit => hit.t < 5).length).toBeGreaterThan(10);
    });

    it('reads the energy off a sliding window the same as sorting every frame', () => {
        // 原来的写法：每帧把 ±1.5 秒内唱着的帧重排一遍
        const reference = (env: VocalEnvelope) => {
            const { db, top, fps } = env;
            const n = db.length, reach = Math.round(1.5 * fps), floor = top - 28;
            const e = new Float32Array(n);
            for (let i = 0; i < n; i += 1) {
                if (db[i] <= floor) continue;
                const win: number[] = [];
                for (let j = Math.max(0, i - reach); j < Math.min(n, i + reach); j += 1) if (db[j] > floor) win.push(db[j]);
                win.sort((a, b) => a - b);
                const a = win[Math.floor(win.length * 0.1)], b = Math.max(a + 3, win[Math.floor(win.length * 0.95)]);
                e[i] = Math.min(1, Math.max(0, (db[i] - a) / (b - a))) ** 1.2;
            }
            return e;
        };
        let seed = 3;
        const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
        // 有唱有停、带重复值的一段
        const db = Float32Array.from({ length: 3000 }, (_, i) => (Math.floor(i / 400) % 2 ? -90 : Math.round(-30 + 20 * rnd())));
        const env: VocalEnvelope = { fps: VOCAL_FPS, db, top: -12, onsets: new Uint32Array(0) };
        expect(Array.from(vocalEnvelopeEnergy(env))).toEqual(Array.from(reference(env)));
        expect(Array.from(vocalEnvelopeEnergy(envelope()))).toEqual(Array.from(reference(envelope())));
    });

    it('rains harder on a louder song: 1x at -17.4 dB, doubling every 8 dB, within 0.5-3x', () => {
        expect(songLoudness(-17.4)).toBeCloseTo(1);
        expect(songLoudness(-9.4)).toBeCloseTo(2);
        expect(songLoudness(-3.8)).toBe(3);
        expect(songLoudness(-40)).toBe(0.5);
    });
});
