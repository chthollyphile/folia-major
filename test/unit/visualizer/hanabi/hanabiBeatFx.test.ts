import { describe, expect, it } from 'vitest';
import type { BeatFxEvent } from '@/services/beatFx/clock';
import {
    firstBeatAtOrAfter,
    rescaleBeatEnvelope,
    resolveHanabiBeatPulse,
    resolveHanabiBeatShell,
} from '@/components/visualizer/hanabi/hanabiBeatFx';

// test/unit/visualizer/hanabi/hanabiBeatFx.test.ts
// 花火的智能动感效果：随拍开花的每一拍只由拍的时刻与种子决定，重拍升空、开得大，没有节奏的小节不开；随拍推镜的包络换算。

const beat = (t: number, patch: Partial<BeatFxEvent> = {}): BeatFxEvent => ({ t, kind: 'beat', ...patch });

describe('随拍开花', () => {
    it('同一拍、同一种子永远开同一朵', () => {
        expect(resolveHanabiBeatShell(beat(12.5), 'probe:p1', 1, 1)).toEqual(resolveHanabiBeatShell(beat(12.5), 'probe:p1', 1, 1));
        expect(resolveHanabiBeatShell(beat(12.5), 'probe:p1', 1, 1)?.sx).not.toBe(resolveHanabiBeatShell(beat(13), 'probe:p1', 1, 1)?.sx);
    });

    it('小节第一拍从底边升空、开在上方中间，比普通拍大', () => {
        const down = resolveHanabiBeatShell(beat(4, { kind: 'downbeat' }), 's', 1, 1)!;
        const plain = resolveHanabiBeatShell(beat(4.5), 's', 1, 1)!;
        expect(down.launch).toBe(true);
        expect(plain.launch).toBe(false);
        expect(down.spec.radius).toBeGreaterThan(plain.spec.radius);
        expect(down.sx).toBeGreaterThanOrEqual(0.2);
        expect(down.sx).toBeLessThanOrEqual(0.8);
        expect(down.sy).toBeLessThanOrEqual(0.32);
    });

    it('没有节奏的小节不开，强度为 0 也不开', () => {
        expect(resolveHanabiBeatShell(beat(3, { rhythmic: false }), 's', 1, 1)).toBeNull();
        expect(resolveHanabiBeatShell(beat(3), 's', 0, 1)).toBeNull();
    });

    it('重音强的拍开得大，强度越大粒子越多', () => {
        const soft = resolveHanabiBeatShell(beat(3, { impact: 0 }), 's', 1, 1)!;
        const hard = resolveHanabiBeatShell(beat(3, { impact: 1 }), 's', 1, 1)!;
        expect(hard.spec.radius).toBeGreaterThan(soft.spec.radius);
        const weak = resolveHanabiBeatShell(beat(3), 's', 0.5, 1)!;
        const strong = resolveHanabiBeatShell(beat(3), 's', 2, 1)!;
        expect(strong.spec.count).toBeGreaterThan(weak.spec.count);
    });

    it('按时刻二分查到第一个不早于它的拍', () => {
        const events = [1, 1.5, 2, 2.5, 3].map(t => beat(t));
        expect(firstBeatAtOrAfter(events, 0)).toBe(0);
        expect(firstBeatAtOrAfter(events, 2)).toBe(2);
        expect(firstBeatAtOrAfter(events, 2.1)).toBe(3);
        expect(firstBeatAtOrAfter(events, 9)).toBe(5);
    });
});

describe('随拍推镜', () => {
    it('没有拍时不动，拍上推近、重拍推得更深', () => {
        expect(resolveHanabiBeatPulse(0, 0, 1)).toEqual({ scale: 1, rotation: 0 });
        const plain = resolveHanabiBeatPulse(1, 0, 1);
        const down = resolveHanabiBeatPulse(1, 1, 1);
        expect(plain.scale).toBeGreaterThan(1);
        expect(down.scale).toBeGreaterThan(plain.scale);
        expect(resolveHanabiBeatPulse(1, 0, -1).rotation).toBeCloseTo(-plain.rotation);
    });

    it('按自己的强度换算时钟的包络', () => {
        // 时钟按 2 倍放大了包络，推镜自己是 1 倍：换算回一半。
        expect(rescaleBeatEnvelope(1.2, 2, 1)).toBeCloseTo(0.6);
        expect(rescaleBeatEnvelope(0.8, 1, 1)).toBeCloseTo(0.8);
        expect(rescaleBeatEnvelope(0.8, 0, 1)).toBe(0);
    });
});
