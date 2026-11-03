import { describe, expect, it } from 'vitest';
import { keyframeIndexAt, keyframeSettleAt, keyframeTicks, nextKeyframeAt, prevKeyframeAt } from '@/utils/ponder/ponderKeyframes';
import { compilePonderScene } from '@/utils/ponder/compilePonderTimeline';
import type { PonderTimelinePlan } from '@/types/ponder';

// test/unit/ponder/ponderKeyframes.test.ts
// 死区是这组函数存在的理由：刚跳到某帧之后再按一次方向键必须继续走，
// 不能因为「当前时间正好等于该帧」而卡住。

const plan: PonderTimelinePlan = {
    totalMs: 1000,
    entries: [],
    keyframes: [
        { stepId: 'a', atMs: 0 },
        { stepId: 'b', atMs: 400 },
        { stepId: 'c', atMs: 800 },
    ],
};

describe('keyframeTicks', () => {
    it('按总时长归一化', () => {
        expect(keyframeTicks(plan)).toEqual([0, 0.4, 0.8]);
    });

    it('总时长为 0 时返回空，不产生 NaN', () => {
        expect(keyframeTicks({ totalMs: 0, entries: [], keyframes: [{ stepId: 'a', atMs: 0 }] })).toEqual([]);
    });
});

describe('keyframeIndexAt', () => {
    it('落在区间内取该区间的序号', () => {
        expect(keyframeIndexAt(plan, 0)).toBe(0);
        expect(keyframeIndexAt(plan, 500)).toBe(1);
        expect(keyframeIndexAt(plan, 950)).toBe(2);
    });
});

describe('nextKeyframeAt', () => {
    it('从区间中段跳到下一帧', () => {
        expect(nextKeyframeAt(plan, 500)).toBe(800);
    });

    it('刚跳到某帧后再按一次仍然前进（死区）', () => {
        expect(nextKeyframeAt(plan, 400)).toBe(800);
    });

    it('越过最后一帧后绕回开头', () => {
        expect(nextKeyframeAt(plan, 900)).toBe(0);
    });
});

describe('prevKeyframeAt', () => {
    it('从区间中段回到上一帧', () => {
        expect(prevKeyframeAt(plan, 700)).toBe(400);
    });

    it('刚过某帧不到死区时长时，视为仍停在该帧上，继续往前退', () => {
        expect(prevKeyframeAt(plan, 500)).toBe(0);
    });

    it('刚跳到某帧后再按一次仍然后退（死区）', () => {
        expect(prevKeyframeAt(plan, 800)).toBe(400);
    });

    it('已在开头时停在 0', () => {
        expect(prevKeyframeAt(plan, 0)).toBe(0);
    });
});

describe('keyframeSettleAt', () => {
    // 一段字幕从开口到到位的时长，由画的人交进来；这里取一个比两个动作都短的数。
    const CAPTION_SETTLE_MS = 300;

    // 动作 420ms + 并行字幕 → pause → 第二个动作 360ms，其并行结果层 520ms 比它长。
    const scenePlan = compilePonderScene({
        id: 'settle', titleKey: 'x', anchors: {},
        steps: [
            { kind: 'highlight', id: 'a', anchor: 'p', durationMs: 420, keyframe: true },
            { kind: 'caption', id: 'ca', textKey: 'x', durationMs: 6000, withPrevious: true },
            { kind: 'pause', id: 'readA' },
            { kind: 'highlight', id: 'b', anchor: 'p', durationMs: 360, keyframe: true },
            { kind: 'surfaceState', id: 'bState', anchor: 'p', state: 's', durationMs: 520, withPrevious: true },
            { kind: 'pause', id: 'readB' },
        ],
    });

    it('动作类关键帧播到动作做完再停，不停在一帧空白上', () => {
        expect(keyframeSettleAt(scenePlan, 0, CAPTION_SETTLE_MS)).toBe(420);
    });

    it('等并行结果层做完，哪怕它比顺序步长', () => {
        expect(keyframeSettleAt(scenePlan, 1820, CAPTION_SETTLE_MS)).toBe(1820 + 520);
    });

    it('pause 类关键帧原地停', () => {
        expect(keyframeSettleAt(scenePlan, 420, CAPTION_SETTLE_MS)).toBe(420);
    });

    it('pause 类关键帧落点时并行结果层还没做完，等它做完', () => {
        // readB 在 1820 + 360，而 bState 的淡入要到 1820 + 520 才完。
        expect(keyframeSettleAt(scenePlan, 1820 + 360, CAPTION_SETTLE_MS)).toBe(1820 + 520);
    });

    it('只有字幕的一拍等字幕淡入就停，不等它读完', () => {
        const captionOnly = compilePonderScene({
            id: 'caption', titleKey: 'x', anchors: {},
            steps: [
                { kind: 'caption', id: 'c', textKey: 'x', durationMs: 6000, keyframe: true },
                { kind: 'pause', id: 'readC' },
            ],
        });
        expect(keyframeSettleAt(captionOnly, 0, CAPTION_SETTLE_MS)).toBe(300);
    });

    it('不越过下一个动作的开头', () => {
        const tight = compilePonderScene({
            id: 'tight', titleKey: 'x', anchors: {},
            steps: [
                { kind: 'highlight', id: 'a', anchor: 'p', durationMs: 200, keyframe: true },
                { kind: 'surfaceState', id: 'aState', anchor: 'p', state: 's', durationMs: 900, withPrevious: true },
                { kind: 'highlight', id: 'b', anchor: 'p', durationMs: 200, keyframe: true },
            ],
        });
        expect(keyframeSettleAt(tight, 0, CAPTION_SETTLE_MS)).toBe(200);
    });
});
