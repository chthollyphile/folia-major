import { describe, expect, it } from 'vitest';
import {
    buildHandwritingDemand, decideHandwriting, findHandwritingAnchor, isBeforeHandwritingLead, resolveHandwritingProgress,
} from '@/components/visualizer/fume/fumeHandwriting';
import type { FumeBlock } from '@/components/visualizer/fume/fumeTypes';

// test/unit/visualizer/fumeHandwriting.test.ts
// 浮名手写笔画的纯逻辑：书写窗口（时长夹在 0.3..1.0 秒）、冻结规则、要向队列报的字。

const block = (start: number, text: string, variant: 'body' | 'hero' = 'body') => ({
    line: { startTime: start }, graphemes: [...text], variant,
}) as unknown as FumeBlock;
const isHan = (ch: string) => ch >= '一' && ch <= '鿿';

describe('resolveHandwritingProgress', () => {
    it('is null before the window and after it', () => {
        expect(resolveHandwritingProgress(10, 10.5, 9.99)).toBeNull();
        expect(resolveHandwritingProgress(10, 10.5, 10.5)).toBeNull();
        expect(resolveHandwritingProgress(10, 10.5, 11)).toBeNull();
        expect(resolveHandwritingProgress(Number.NaN, 11, 10)).toBeNull();
    });

    it('lasts the grapheme duration clamped to 0.3..1.0 s, and eases out', () => {
        // 0.1 s 的字也写 0.3 s；5 s 的字只写 1 s
        expect(resolveHandwritingProgress(0, 0.1, 0.29)).not.toBeNull();
        expect(resolveHandwritingProgress(0, 0.1, 0.3)).toBeNull();
        expect(resolveHandwritingProgress(0, 5, 0.99)).not.toBeNull();
        expect(resolveHandwritingProgress(0, 5, 1)).toBeNull();
        // 缓出：过一半时间已经写过一半以上
        expect(resolveHandwritingProgress(0, 0.6, 0.3)!).toBeGreaterThan(0.5);
        expect(resolveHandwritingProgress(0, 0.6, 0)).toBe(0);
    });
});

describe('isBeforeHandwritingLead', () => {
    it('covers just the stretch before the window where the plain path would already light the char up', () => {
        // 普通画法的提前量是字时长的 16%：这一段 20% 要把它盖住
        expect(isBeforeHandwritingLead(9.91, 10, 0.5)).toBe(true);
        expect(isBeforeHandwritingLead(10 - 0.5 * 0.16, 10, 0.5)).toBe(true);
        expect(isBeforeHandwritingLead(9.8, 10, 0.5)).toBe(false);
        expect(isBeforeHandwritingLead(10, 10, 0.5)).toBe(false);
        expect(isBeforeHandwritingLead(10.2, 10, 0.5)).toBe(false);
    });
});

describe('decideHandwriting freeze rule', () => {
    it('decides on the first frame of the window and keeps that', () => {
        const decisions = new Map<string, boolean>();
        let has = false;
        expect(decideHandwriting(decisions, 'k', true, () => has)).toBe(false);
        has = true; // 遮罩中途才到：这个字这一遍仍是普通画法
        expect(decideHandwriting(decisions, 'k', true, () => has)).toBe(false);
        expect(decideHandwriting(decisions, 'k', true, () => has)).toBe(false);
    });

    it('keeps a reveal that was there at the start even if it goes away', () => {
        const decisions = new Map<string, boolean>();
        expect(decideHandwriting(decisions, 'k', true, () => true)).toBe(true);
        expect(decideHandwriting(decisions, 'k', true, () => false)).toBe(true);
    });

    it('forgets outside the window so a replay after a seek decides again', () => {
        const decisions = new Map<string, boolean>();
        decideHandwriting(decisions, 'k', true, () => false);
        expect(decideHandwriting(decisions, 'k', false, () => true)).toBe(false);
        expect(decisions.size).toBe(0);
        expect(decideHandwriting(decisions, 'k', true, () => true)).toBe(true);
    });
});

describe('handwriting demand', () => {
    const blocks = [0, 10, 20, 30, 40, 50, 60].map((t, i) => block(t, `${'一二三四五六七'[i]}a`, i === 0 ? 'hero' : 'body'));

    it('anchors on the last line that has started', () => {
        expect(findHandwritingAnchor(blocks, -5)).toBe(0);
        expect(findHandwritingAnchor(blocks, 10)).toBe(1);
        expect(findHandwritingAnchor(blocks, 35)).toBe(3);
        expect(findHandwritingAnchor(blocks, 999)).toBe(6);
    });

    it('is the current + next 4 lines near, the rest far, earlier lines last; model chars only, with the variant weight', () => {
        const demand = buildHandwritingDemand(blocks, 1, v => (v === 'hero' ? 780 : 640), isHan);
        expect(demand.map(d => d.ch).join('')).toBe('二三四五六七一');
        expect(demand.filter(d => d.near).map(d => d.ch).join('')).toBe('二三四五六');
        expect(demand.find(d => d.ch === '七')!.near).toBe(false);
        expect(demand.find(d => d.ch === '一')).toMatchObject({ near: false, weight: 780 });
        expect(demand.find(d => d.ch === '二')!.weight).toBe(640);
    });

    it('lists a char once per weight', () => {
        const twice = [block(0, '一', 'hero'), block(5, '一', 'body'), block(9, '一', 'body')];
        const demand = buildHandwritingDemand(twice, 0, v => (v === 'hero' ? 780 : 640), isHan);
        expect(demand.map(d => d.weight)).toEqual([780, 640]);
    });
});
