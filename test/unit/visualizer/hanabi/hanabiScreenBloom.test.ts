import { describe, expect, it } from 'vitest';
import type { Line } from '@/types';
import { getLineRenderEndTime } from '@/utils/lyrics/renderHints';
import {
    HANABI_SCREEN_BLOOM,
    resolveHanabiChorusSpans,
    resolveHanabiChorusWeight,
    resolveHanabiScreenBloomStrength,
} from '@/components/visualizer/hanabi/hanabiScreenBloom';
import { compileHanabiProgram } from '@/components/visualizer/hanabi/hanabiProgram';

// test/unit/visualizer/hanabi/hanabiScreenBloom.test.ts
// 花火的全屏辉光：副歌行并成时段、时段前后平滑亮起收回、强度 = 整体辉光 + 副歌辉光 × 副歌权重。

const line = (startTime: number, isChorus: boolean): Line => ({
    fullText: 'la la la',
    words: [{ text: 'la la la', startTime, endTime: startTime + 2.5 }],
    startTime,
    endTime: startTime + 2.5,
    isChorus,
});

describe('副歌时段', () => {
    it('相邻的副歌行并成一段，中间隔着主歌的分开', () => {
        const lines = [line(0, false), line(3, true), line(6, true), line(9, false), line(12, true)];
        expect(resolveHanabiChorusSpans(lines)).toEqual([
            { startTime: 3, endTime: 9 },
            { startTime: 12, endTime: getLineRenderEndTime(lines[4]!) },
        ]);
    });

    it('空隙很短的两段副歌并起来', () => {
        // 第一段副歌到下一行（主歌）开始的 3 秒，下一段副歌 3.8 秒开始：空隙 0.8 秒 < 1.5 秒，并成一段。
        const lines = [line(0, true), line(3, false), line(3.8, true)];
        expect(resolveHanabiChorusSpans(lines)).toEqual([{ startTime: 0, endTime: getLineRenderEndTime(lines[2]!) }]);
        // 空隙 2 秒：分成两段。
        const apart = [line(0, true), line(3, false), line(5, true)];
        expect(resolveHanabiChorusSpans(apart)).toHaveLength(2);
    });

    it('编译出的程序带着副歌时段', () => {
        const lines = [line(0, false), line(3, true), line(6, true)];
        const program = compileHanabiProgram(lines, 'seed');
        expect(program.chorus).toEqual([{ startTime: 3, endTime: getLineRenderEndTime(lines[2]!) }]);
        expect(compileHanabiProgram([], 'seed').chorus).toEqual([]);
    });
});

describe('副歌权重', () => {
    const spans = [{ startTime: 10, endTime: 20 }];

    it('副歌里是 1，副歌外是 0，前后平滑过渡', () => {
        expect(resolveHanabiChorusWeight(spans, 5)).toBe(0);
        expect(resolveHanabiChorusWeight(spans, 15)).toBe(1);
        expect(resolveHanabiChorusWeight(spans, 25)).toBe(0);
        const rampIn = resolveHanabiChorusWeight(spans, 9.9);
        expect(rampIn).toBeGreaterThan(0);
        expect(rampIn).toBeLessThan(1);
        const rampOut = resolveHanabiChorusWeight(spans, 20.3);
        expect(rampOut).toBeGreaterThan(0);
        expect(rampOut).toBeLessThan(1);
    });

    it('权重随时间连续，没有跳变', () => {
        for (let time = 8; time < 23; time += 1 / 120) {
            expect(Math.abs(resolveHanabiChorusWeight(spans, time + 1 / 120) - resolveHanabiChorusWeight(spans, time))).toBeLessThan(0.03);
        }
    });
});

describe('全屏辉光强度', () => {
    it('整体辉光常驻，副歌辉光按权重叠加，两个都是 0 时没有', () => {
        expect(resolveHanabiScreenBloomStrength(0, 1, 0)).toBe(0);
        expect(resolveHanabiScreenBloomStrength(0, 1, 1)).toBeCloseTo(HANABI_SCREEN_BLOOM.chorus);
        expect(resolveHanabiScreenBloomStrength(1, 1, 0)).toBeCloseTo(HANABI_SCREEN_BLOOM.base);
        expect(resolveHanabiScreenBloomStrength(1, 2, 0.5)).toBeCloseTo(HANABI_SCREEN_BLOOM.base + HANABI_SCREEN_BLOOM.chorus);
        expect(resolveHanabiScreenBloomStrength(0, 0, 1)).toBe(0);
    });
});
