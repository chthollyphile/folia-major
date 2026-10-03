import { describe, expect, it } from 'vitest';
import {
    createBandOnsetTracker,
    stepBandOnsetTracker,
    stepEnvelopeToward,
} from '@/components/visualizer/bandOnsetTracker';

// test/unit/visualizer/bandOnsetTracker.test.ts
// 公共起音检测 + 非对称包络的契约。这套实现原本只给 diorama 用，现在波环的「重拍透视」
// 也共用它，所以在这里独立锁一遍：稳态鼓点不会失去灵敏度、一下鼓点只触发一次、
// 包络有前摇而不是瞬间到位。

/** 0.9 的短促鼓点，每 0.5s 一下，间隙回到 0.3 —— 就是当年「灵敏度衰减」那个场景。 */
const steadyKick = (t: number): number => (((t % 0.5) < 0.09) ? 0.9 : 0.3);

const runKicks = (seconds: number, step: number, level: (t: number) => number) => {
    const tracker = createBandOnsetTracker();
    const frames: Array<{ t: number; onset: boolean; transient: number }> = [];
    for (let t = 0; t < seconds; t += step) {
        const signal = stepBandOnsetTracker(tracker, level(t), step);
        frames.push({ t, onset: signal.onset, transient: signal.transient });
    }
    return frames;
};

describe('stepBandOnsetTracker', () => {
    it('keeps answering a steady kick a minute in, instead of fading to silence', () => {
        const frames = runKicks(60, 1 / 60, steadyKick);
        const countOnsets = (from: number, to: number) => frames
            .filter(frame => frame.t >= from && frame.t < to && frame.onset)
            .length;

        expect(countOnsets(2, 6)).toBeGreaterThanOrEqual(6);
        // 关键：一分钟后仍然按同样的密度触发（旧的 ratio/EMA 模型这里会归零）。
        expect(countOnsets(54, 58)).toBeGreaterThanOrEqual(6);
    });

    it('fires once per kick rather than once per loud frame', () => {
        const frames = runKicks(6, 1 / 60, steadyKick);
        const onsets = frames.filter(frame => frame.onset).length;
        // 6 秒 / 0.5 秒一下 = 12 下；迟滞保证不会在一个鼓点里连发。
        expect(onsets).toBeLessThanOrEqual(13);
        expect(onsets).toBeGreaterThanOrEqual(10);
    });

    it('does not fire on silence or on a steady tone', () => {
        expect(runKicks(4, 1 / 60, () => 0).some(frame => frame.onset)).toBe(false);
        expect(runKicks(4, 1 / 60, () => 0.8).some(frame => frame.onset)).toBe(false);
    });
});

describe('stepEnvelopeToward', () => {
    it('rises over the attack rather than jumping to the target (the windup)', () => {
        const attackRate = 1 / 0.09;   // 面板上的 0.09s 前摇
        const releaseRate = 1 / 0.38;
        let value = 0;
        const step = 1 / 60;

        // 一帧之后远远没到峰值。
        value = stepEnvelopeToward(value, 1, attackRate, releaseRate, step);
        expect(value).toBeGreaterThan(0);
        expect(value).toBeLessThan(0.25);

        // 一个前摇时长后到约 63%，而不是 100%。
        const afterAttack = stepEnvelopeToward(value, 1, attackRate, releaseRate, 0.09);
        expect(afterAttack).toBeGreaterThan(0.6);
        expect(afterAttack).toBeLessThan(0.95);
    });

    it('decays exponentially once the target drops back to zero', () => {
        const releaseRate = 1 / 0.38;
        let value = 1;
        value = stepEnvelopeToward(value, 0, 1 / 0.09, releaseRate, 0.38);
        expect(value).toBeCloseTo(Math.exp(-1), 5);
        // 单调下降，不会跳到 0 也不会反冲。
        const next = stepEnvelopeToward(value, 0, 1 / 0.09, releaseRate, 0.38);
        expect(next).toBeLessThan(value);
        expect(next).toBeGreaterThan(0);
    });

    it('uses the faster rate when the target is above and the slower one below', () => {
        const attack = 20;
        const release = 2;
        const up = stepEnvelopeToward(0, 1, attack, release, 0.1);
        const down = stepEnvelopeToward(1, 0, attack, release, 0.1);
        // 同样的 dt，上升走得比下降远（不对称）。
        expect(up).toBeGreaterThan(1 - down);
    });
});
