import { describe, expect, it } from 'vitest';
import { NebbiaDrumBumps } from '@/components/visualizer/nebbia/nebbiaDrumBumps';
import { DRUM_HAT, DRUM_KICK, DRUM_SNARE, type DrumHits } from '@/services/analysis/drumHits';

// test/unit/visualizer/nebbiaDrumBumps.test.ts
// 疏雨轻车的鼓点颠簸：只在够响的底鼓上颠，至少隔 0.3 秒；拖进度、换表只挪游标，不补颠。

const hits = (list: [number, number, number][]): DrumHits => ({
    times: Float64Array.from(list, ([t]) => t),
    strengths: Float32Array.from(list, ([, s]) => s),
    kinds: Uint8Array.from(list, ([, , k]) => k),
});

/** 从 from 走到 to，每帧 1/60 秒，记下颠的时刻和幅度。 */
const play = (bumps: NebbiaDrumBumps, list: DrumHits, from: number, to: number) => {
    const out: [number, number][] = [];
    for (let T = from; T <= to; T += 1 / 60) {
        const amount = bumps.step(list, 'song', T);
        if (amount > 0) out.push([T, amount]);
    }
    return out;
};

describe('nebbia drum bumps', () => {
    it('jolts on loud kicks only, at least 0.3 s apart, as hard as the kick', () => {
        const list = hits([[1, 0.9, DRUM_KICK], [1.1, 0.9, DRUM_KICK], [1.5, 0.9, DRUM_SNARE], [2, 0.2, DRUM_KICK], [2.5, 0.5, DRUM_KICK], [3, 1, DRUM_HAT]]);
        const bumps = new NebbiaDrumBumps();
        const jolts = play(bumps, list, 0, 4);
        expect(jolts.map(([T]) => Math.round(T * 10) / 10)).toEqual([1, 2.5]);
        expect(jolts[0][1]).toBeCloseTo(0.3 + 0.7 * 0.9, 5);
        expect(jolts[1][1]).toBeCloseTo(0.3 + 0.7 * 0.5, 5);
    });

    it('does not make up the kicks a seek jumps over', () => {
        const list = hits([[1, 1, DRUM_KICK], [5, 1, DRUM_KICK], [9, 1, DRUM_KICK]]);
        const bumps = new NebbiaDrumBumps();
        expect(play(bumps, list, 0, 2)).toHaveLength(1);
        // Jumped from 2 s to 8 s: the kick at 5 s is passed over, the one at 9 s plays.
        expect(play(bumps, list, 8, 10).map(([T]) => Math.round(T))).toEqual([9]);
        // And back: nothing until the next kick ahead.
        expect(play(bumps, list, 0.5, 1.5).map(([T]) => Math.round(T))).toEqual([1]);
    });
});
