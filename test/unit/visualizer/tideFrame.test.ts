import { describe, expect, it } from 'vitest';
import {
    tideInkFade,
    tideLoudnessDissipation,
    tideTrailSeconds,
} from '@/components/visualizer/backgrounds/tide/tideFrame';

// test/unit/visualizer/tideFrame.test.ts
// 流体每帧的衰减：拖尾长度由 dissipation 决定，并随响度逐帧缩放 —— 安静时短（干净利落），
// 大声时长（翻涌）。这里锁住映射的单调性与端点行为，防止面板值被这层缩放悄悄改掉。
describe('tide frame dissipation', () => {
    it('maps dissipation onto the reference trail length', () => {
        expect(tideTrailSeconds(0)).toBeCloseTo(0.6, 6);
        expect(tideTrailSeconds(1)).toBeCloseTo(2.4, 6);
        // 拖尾越长，每帧的衰减系数越小。
        expect(tideInkFade(1)).toBeLessThan(tideInkFade(0));
    });

    it('shortens the trail when loud and keeps the setting when quiet', () => {
        expect(tideLoudnessDissipation(0.6, 0)).toBeCloseTo(0.6, 6);
        expect(tideLoudnessDissipation(0.6, 1)).toBeCloseTo(0.6 * 0.45, 6);
        // 单调：越响耗散越小（尾越长）。
        expect(tideLoudnessDissipation(0.6, 1)).toBeLessThan(tideLoudnessDissipation(0.6, 0.5));
        expect(tideLoudnessDissipation(0.6, 0.5)).toBeLessThan(tideLoudnessDissipation(0.6, 0));
        // 越界按端点处理：dissipation 钳在 0..1，响度钳在 0..1。
        expect(tideLoudnessDissipation(2, 0)).toBeCloseTo(1, 6);
        expect(tideLoudnessDissipation(-1, 0)).toBe(0);
        expect(tideLoudnessDissipation(0.6, 2)).toBeCloseTo(tideLoudnessDissipation(0.6, 1), 6);
    });
});
