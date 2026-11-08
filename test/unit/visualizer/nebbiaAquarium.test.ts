import { describe, expect, it } from 'vitest';
import type { BeatFxEvent } from '@/services/beatFx/clock';
import { NebbiaAquarium, type NebbiaAquaBeats } from '@/components/visualizer/nebbia/nebbiaAquarium';
import { DEFAULT_NEBBIA_TUNING } from '@/components/visualizer/nebbia/types';

// test/unit/visualizer/nebbiaAquarium.test.ts
// 水族箱：设置里的水母只数和大小、气泡多少交给着色器；「舞潮踏拍」开着时走过一拍，水母收一下（小节第一拍全收）、
// 水草左右交替摇、沙底冒一排大泡，三项各按自己的强度，没有节拍的小节不动；拖进度、换节拍表只挪游标，不补拍。

const DT = 1 / 60;
const tuning = { ...DEFAULT_NEBBIA_TUNING, behind: 'aquarium' as const };
const all = (events: BeatFxEvent[], patch: Partial<NebbiaAquaBeats> = {}): NebbiaAquaBeats => ({ events, heard: 0, jelly: 1, weed: 1, bubble: 1, spot: 1, ...patch });
const pulses = (out: { jelly: Float32Array; count: number }) => Array.from({ length: out.count }, (_, i) => out.jelly[i * 4 + 3]);

/** 跟拍走到 T（每帧 DT，听到的时刻就是 T），返回最后一帧的 uniform。 */
const runTo = (aquarium: NebbiaAquarium, beats: NebbiaAquaBeats | null, from: number, to: number, onFrame?: (out: ReturnType<NebbiaAquarium['step']>) => void) => {
    const at = (T: number) => (beats ? { ...beats, heard: T } : null);
    let out = aquarium.step(0, from, 1.6, tuning, at(from));
    for (let T = from + DT; T <= to + 1e-9; T += DT) {
        out = aquarium.step(DT, T, 1.6, tuning, at(T));
        onFrame?.(out);
    }
    return out;
};

describe('nebbia aquarium', () => {
    it('hands the shader the slider count, size and bubbles', () => {
        const out = new NebbiaAquarium().step(DT, 0, 1.6, { ...tuning, jellies: 5, jellySize: 1.5, bubbles: 0.3 }, null);
        expect(out.count).toBe(5);
        expect(out.bubbles).toBe(0.3);
        for (let i = 0; i < 5; i += 1) {
            expect(out.jelly[i * 4 + 2]).toBeGreaterThanOrEqual(0.03 * 1.5);
            expect(out.jelly[i * 4 + 2]).toBeLessThanOrEqual(0.085 * 1.5);
        }
        expect(out.burstCount).toBe(0);
    });

    it('squeezes every jelly, sways the weed and sends up a row of bubbles on a downbeat', () => {
        const events: BeatFxEvent[] = [{ t: 1, kind: 'downbeat', impact: 1 }];
        const before = runTo(new NebbiaAquarium(), all(events), 0, 0.98);
        expect(Math.min(...pulses(before))).toBeLessThan(0.8);
        expect(before.burstCount).toBe(0);
        const after = runTo(new NebbiaAquarium(), all(events), 0, 1.08);
        expect(Math.min(...pulses(after))).toBeGreaterThan(0.8);
        expect(Math.abs(after.sway[0])).toBeGreaterThan(0.3);
        // 梢比根晚到
        expect(Math.abs(after.sway[3])).toBeLessThan(Math.abs(after.sway[0]));
        expect(after.burstCount).toBe(1);
        expect(after.bursts[2]).toBeCloseTo(1);
    });

    it('sways to alternate sides without a jump from one beat to the next', () => {
        const events: BeatFxEvent[] = Array.from({ length: 12 }, (_, i) => ({ t: 1 + i * 0.4, kind: i % 4 ? 'beat' : 'downbeat', impact: 1 }));
        let last: number | null = null, maxStep = 0, min = 0, max = 0;
        runTo(new NebbiaAquarium(), all(events), 0, 6, out => {
            if (last !== null) maxStep = Math.max(maxStep, Math.abs(out.sway[3] - last));
            last = out.sway[3];
            min = Math.min(min, out.sway[0]);
            max = Math.max(max, out.sway[0]);
        });
        // 每帧只挪一小段（弹簧的速度），摆幅不越拍越大
        expect(maxStep).toBeLessThan(0.3);
        expect(min).toBeLessThan(-0.3);
        expect(max).toBeGreaterThan(0.3);
        expect(Math.max(-min, max)).toBeLessThan(1.6);
    });

    it('squeezes a jelly still relaxing from the last beat without letting go first', () => {
        const events: BeatFxEvent[] = Array.from({ length: 8 }, (_, i) => ({ t: 1 + i * 0.45, kind: 'downbeat', impact: 1 }));
        let worst = Infinity, T = 0;
        runTo(new NebbiaAquarium(), all(events), 0, 4.4, out => {
            T += DT;
            // 浮出上沿、换到底下画面外重来的那只不算（新的一只，还没收过）
            if (T > 1.1) pulses(out).forEach((p, i) => { if (out.jelly[i * 4 + 1] < 1.2) worst = Math.min(worst, p); });
        });
        // 跟拍时最松的时候也还留着上一下的收缩（不会掉回 0 再收）
        expect(worst).toBeGreaterThan(0.2);
    });

    it('stops the random big bubbles while the beat sends up rows', () => {
        const events: BeatFxEvent[] = [{ t: 1, kind: 'downbeat', impact: 1 }];
        expect(runTo(new NebbiaAquarium(), all(events), 0, 0.5).beatRows).toBe(1);
        expect(runTo(new NebbiaAquarium(), null, 0, 0.5).beatRows).toBe(0);
        expect(runTo(new NebbiaAquarium(), all(events, { bubble: 0 }), 0, 0.5).beatRows).toBe(0);
    });

    it('swells the spotlight pool on the beat and lets it shrink back', () => {
        const events: BeatFxEvent[] = [{ t: 1, kind: 'downbeat', impact: 1 }];
        expect(runTo(new NebbiaAquarium(), all(events), 0, 0.95).spotScale).toBe(1);
        expect(runTo(new NebbiaAquarium(), all(events), 0, 1.08).spotScale).toBeGreaterThan(1.35);
        expect(runTo(new NebbiaAquarium(), all(events), 0, 3).spotScale).toBeLessThan(1.01);
        expect(runTo(new NebbiaAquarium(), all(events, { spot: 0 }), 0, 1.08).spotScale).toBe(1);
    });

    it('moves only the parts with a strength', () => {
        const events: BeatFxEvent[] = [{ t: 1, kind: 'downbeat', impact: 1 }];
        const out = runTo(new NebbiaAquarium(), all(events, { jelly: 0, bubble: 0 }), 0, 1.08);
        expect(Math.min(...pulses(out))).toBeLessThan(0.8);
        expect(out.burstCount).toBe(0);
        expect(Math.abs(out.sway[1])).toBeGreaterThan(0);
    });

    it('skips a beat in a bar with no rhythm', () => {
        const out = runTo(new NebbiaAquarium(), all([{ t: 1, kind: 'downbeat', impact: 1, rhythmic: false }]), 0, 1.08);
        expect(Math.min(...pulses(out))).toBeLessThan(0.8);
        expect(out.burstCount).toBe(0);
    });

    it('fires nothing for the beats jumped over by a seek', () => {
        const events: BeatFxEvent[] = Array.from({ length: 20 }, (_, i) => ({ t: 1 + i * 0.5, kind: 'downbeat', impact: 1 }));
        const aquarium = new NebbiaAquarium();
        runTo(aquarium, all(events), 0, 0.5);
        // 跳到 8.2 秒：中间 14 拍都不补
        const out = aquarium.step(DT, 0.5 + DT, 1.6, tuning, { ...all(events), heard: 8.2 });
        expect(Math.min(...pulses(out))).toBeLessThan(0.8);
        expect(out.burstCount).toBe(0);
    });

    it('drops a row once it has floated away', () => {
        const events: BeatFxEvent[] = [{ t: 1, kind: 'beat', impact: 1 }];
        const out = runTo(new NebbiaAquarium(), all(events), 0, 8);
        expect(out.burstCount).toBe(0);
    });

    it('fades the idle weed sway out while the weed follows the beat, and back in when it stops', () => {
        const aquarium = new NebbiaAquarium();
        expect(runTo(aquarium, null, 0, 1).weedIdle).toBe(1);
        // 水草一项开着：一下子不跳，几秒内收到 0
        const first = aquarium.step(DT, 1, 1.6, tuning, all([]));
        expect(first.weedIdle).toBeGreaterThan(0.9);
        expect(runTo(aquarium, all([]), 1, 4).weedIdle).toBeLessThan(0.01);
        // 水草一项关掉（或不跟拍）：慢慢摆回来
        expect(runTo(aquarium, all([], { weed: 0 }), 4, 4.1).weedIdle).toBeLessThan(0.5);
        expect(runTo(aquarium, null, 4.1, 8).weedIdle).toBeGreaterThan(0.99);
    });
});
