import { describe, expect, it, vi, afterEach } from 'vitest';
import { announceTransition, getActiveTransitionCue, subscribeToTransitionCue } from '@/services/automix/transitionCue';

// test/unit/automix/transitionCue.test.ts
// 一次混音有两个画法（屏幕中央的圆环、now playing 卡片的边框），而哪一个在场是会在混音中途变的：
// 首页和歌词页之间来回、或者动卡片自己的设置。cue 是广播出来的、不重播，所以中途挂载的那个必须
// 能问出「现在有什么在跑、跑到哪了」，否则这次混音剩下的时间里它什么都不画。

const CUE = { seconds: 10, crossover: 0.55, periodSec: 0.5 };

afterEach(() => {
    announceTransition(null);
    vi.restoreAllMocks();
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
