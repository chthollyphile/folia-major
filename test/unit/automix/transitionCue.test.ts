import { describe, expect, it, vi, afterEach } from 'vitest';
import {
    announceTransition,
    getActiveTransitionCue,
    shouldDrawCue,
    subscribeToTransitionCue,
} from '@/services/automix/transitionCue';

// test/unit/automix/transitionCue.test.ts
// 一次混音有两个画法（屏幕中央的圆环、now playing 卡片的边框），而哪一个在场是会在混音中途变的：
// 首页和歌词页之间来回、或者动卡片自己的设置。cue 是广播出来的、不重播，所以中途挂载的那个必须
// 能问出「现在有什么在跑、跑到哪了」，否则这次混音剩下的时间里它什么都不画。

const CUE = { seconds: 10, crossover: 0.55, periodSec: 0.5 };

afterEach(() => {
    announceTransition(null);
    vi.restoreAllMocks();
});

// 两个画法共用的那一条规则。写在这里而不是各自组件里，因为两边只在「用哪个开关」
// 上不一样，其余全是这次过渡自己的属性。
describe('shouldDrawCue', () => {
    it('开关开着、不是纯淡化、又够长才画', () => {
        expect(shouldDrawCue(CUE, true, 'ring')).toBe(true);
    });

    it('开关关着就不画', () => {
        expect(shouldDrawCue(CUE, false, 'ring')).toBe(false);
    });

    // 遥控窗口要的正是这一条（它不走这个函数），而屏幕上不能把交叉淡化说成混音。
    it('标了 plain 的不画，开关开着也不画', () => {
        expect(shouldDrawCue({ ...CUE, plain: true }, true, 'ring')).toBe(false);
    });

    it('短于 5 秒的不画', () => {
        expect(shouldDrawCue({ ...CUE, seconds: 4.9 }, true, 'ring')).toBe(false);
        expect(shouldDrawCue({ ...CUE, seconds: 5 }, true, 'ring')).toBe(true);
    });

    // 广播是发给所有人的，演示只欠一个人。没有收件人的时候，另一个画法只要碰巧开着，就会在
    // 邻居的开关被拨动时跟着重放一遍——两个开关看起来就是一个。
    it('演示只有收件人自己画', () => {
        expect(shouldDrawCue({ ...CUE, preview: 'ring' }, true, 'ring')).toBe(true);
        expect(shouldDrawCue({ ...CUE, preview: 'ring' }, true, 'card')).toBe(false);
        expect(shouldDrawCue({ ...CUE, preview: 'card' }, true, 'card')).toBe(true);
        expect(shouldDrawCue({ ...CUE, preview: 'card' }, true, 'ring')).toBe(false);
    });

    // 真交接没有收件人，两个都画。
    it('真交接两个画法都画', () => {
        expect(shouldDrawCue(CUE, true, 'ring')).toBe(true);
        expect(shouldDrawCue(CUE, true, 'card')).toBe(true);
    });
});

describe('getActiveTransitionCue', () => {
    it('是 null 直到有混音开始', () => {
        expect(getActiveTransitionCue()).toBeNull();
    });

    it('报出正在跑的那次，以及已经走过多久', () => {
        const now = vi.spyOn(performance, 'now').mockReturnValue(1_000);
        announceTransition(CUE);

        now.mockReturnValue(4_000);
        expect(getActiveTransitionCue()).toEqual({ cue: CUE, elapsedMs: 3_000 });
    });

    it('settle 之后回到 null', () => {
        announceTransition(CUE);
        announceTransition(null);
        expect(getActiveTransitionCue()).toBeNull();
    });

    // 没有 settle 的路径是存在的（被打断时那条 null 走的是音频链），所以过期要自己认出来，
    // 不能让中途挂载的画法捡到一次早就结束的混音、从头画一遍。
    it('自己的时钟跑完之后就算没有 settle 也是 null', () => {
        const now = vi.spyOn(performance, 'now').mockReturnValue(0);
        announceTransition(CUE);

        now.mockReturnValue(9_999);
        expect(getActiveTransitionCue()).not.toBeNull();
        now.mockReturnValue(10_000);
        expect(getActiveTransitionCue()).toBeNull();
    });

    // 读它不该有副作用：调用方是在 render 阶段的 useState 初值里读的。
    it('读两次结果一样', () => {
        const now = vi.spyOn(performance, 'now').mockReturnValue(0);
        announceTransition(CUE);
        now.mockReturnValue(2_000);
        expect(getActiveTransitionCue()).toEqual(getActiveTransitionCue());
    });

    it('广播照旧到得了订阅者', () => {
        const seen: unknown[] = [];
        const off = subscribeToTransitionCue(cue => seen.push(cue));
        announceTransition(CUE);
        announceTransition(null);
        off();
        expect(seen).toEqual([CUE, null]);
    });
});

// 设置页拨开关时会广播一条 preview 当场演示。它和真交接共用这一条通道，而通道上记着的
// 「正在跑的是哪一次」是所有中途接手的画法唯一的依据——被一条十秒的演示盖掉之后，接手的
// 那个会照演示的长度画一条和音频对不上的进度条。遥控窗口早就单独挡了 preview，这里挡的是
// active 那一半。
describe('演示不盖真交接', () => {
    const PREVIEW = { ...CUE, preview: 'ring' } as const;

    it('真混音正在跑时，演示既不记也不广播', () => {
        const now = vi.spyOn(performance, 'now').mockReturnValue(0);
        announceTransition(CUE);

        now.mockReturnValue(3_000);
        const seen: unknown[] = [];
        const off = subscribeToTransitionCue(cue => seen.push(cue));
        announceTransition(PREVIEW);
        off();

        expect(seen).toEqual([]);
        expect(getActiveTransitionCue()).toEqual({ cue: CUE, elapsedMs: 3_000 });
    });

    it('真交接反过来永远盖得掉演示', () => {
        announceTransition(PREVIEW);
        announceTransition(CUE);
        expect(getActiveTransitionCue()?.cue).toBe(CUE);
    });

    it('上一条演示跑完之后，下一条演示照常', () => {
        const now = vi.spyOn(performance, 'now').mockReturnValue(0);
        announceTransition(PREVIEW);

        now.mockReturnValue(10_000);
        announceTransition(PREVIEW);
        expect(getActiveTransitionCue()?.cue).toBe(PREVIEW);
    });

    it('真混音跑完之后不再挡演示', () => {
        const now = vi.spyOn(performance, 'now').mockReturnValue(0);
        announceTransition(CUE);

        now.mockReturnValue(10_000);
        announceTransition(PREVIEW);
        expect(getActiveTransitionCue()?.cue).toBe(PREVIEW);
    });
});
