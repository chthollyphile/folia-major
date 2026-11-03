import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { advanceLoopPressStreak, type LoopPressStreak } from '@/services/ponder/loopShuffleHint';

// test/unit/ponder/loopShuffleHint.test.ts
// 连点循环按钮三下弹「想找随机播放吗」，间隔太长不算连点，整个生命周期最多弹两次。
// 提示在连点停下之后才弹（否则会被循环模式 toast 盖掉），次数在弹出之后才记。

const fresh: LoopPressStreak = { count: 0, lastAt: -Infinity };

const pressAt = (times: number[]) => {
    let streak = fresh;
    return times.map(now => {
        const next = advanceLoopPressStreak(streak, now);
        streak = next.streak;
        return next.triggered;
    });
};

describe('advanceLoopPressStreak', () => {
    it('连点第三下触发，之后从头数', () => {
        expect(pressAt([0, 300, 600, 900, 1200, 1500])).toEqual([false, false, true, false, false, true]);
    });

    it('两下之间隔太久就重新数', () => {
        expect(pressAt([0, 300, 2500, 2800, 3100])).toEqual([false, false, false, false, true]);
    });
});

describe('noteLoopButtonPress（按真实按钮的调用顺序：切循环 → 模式 toast → 记一下）', () => {
    const COUNT_KEY = 'folia_loop_shuffle_hint_count';
    let storage: Map<string, string>;

    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        storage = new Map();
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => { storage.set(key, value); },
            removeItem: (key: string) => { storage.delete(key); },
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    const load = async () => {
        const { useStatusMessageStore } = await import('@/stores/useStatusMessageStore');
        const { usePonderStore } = await import('@/stores/usePonderStore');
        const { useAudioSettingsStore } = await import('@/stores/useAudioSettingsStore');
        const { resolvePlayerControlSlot } = await import('@/components/floating-player/playerControlSlotActions');

        // 浮动播放器的循环槽位：真实的 handleToggleLoopMode 先弹模式 toast，再记一下。
        // SoundTiles 的循环那一块的 onClick 是同一个顺序（onToggleLoop(event) 之后 noteLoopButtonPress()）。
        const slot = resolvePlayerControlSlot('loop', {
            loopMode: 'off',
            onToggleLoop: () => useAudioSettingsStore.getState().handleToggleLoopMode(),
        } as Parameters<typeof resolvePlayerControlSlot>[1]);

        const message = () => useStatusMessageStore.getState().message;
        const isHint = () => message()?.onAction !== undefined;
        /** 先等 gapMs，再按一下循环按钮。 */
        const click = (gapMs = 0) => {
            vi.advanceTimersByTime(gapMs);
            slot.onActivate();
        };
        const clickTimes = (n: number, gapMs = 200) => {
            for (let k = 0; k < n; k += 1) click(k === 0 ? 0 : gapMs);
        };
        return { useStatusMessageStore, usePonderStore, message, isHint, click, clickTimes };
    };

    it('连点 4 次：第 4 下的模式 toast 不会盖掉提示，停下 1.5 秒后提示可见且只记 1 次', async () => {
        const { message, isHint, clickTimes } = await load();
        clickTimes(4);
        // 第三下凑满时不立刻弹，当前显示的是第四下的循环模式 toast，额度也没动。
        expect(isHint()).toBe(false);
        expect(message()?.type).toBe('success');
        expect(storage.has(COUNT_KEY)).toBe(false);

        vi.advanceTimersByTime(1499);
        expect(isHint()).toBe(false);
        expect(storage.has(COUNT_KEY)).toBe(false);

        vi.advanceTimersByTime(1);
        expect(isHint()).toBe(true);
        expect(message()?.actionLabel).toBeTruthy();
        expect(storage.get(COUNT_KEY)).toBe('1');

        // 之后不会再冒第二条。
        vi.advanceTimersByTime(60_000);
        expect(storage.get(COUNT_KEY)).toBe('1');
    });

    it('连点 7 次（中途凑满两回）：合并成一条提示，只消耗 1 次额度', async () => {
        const { isHint, clickTimes } = await load();
        clickTimes(7);
        expect(isHint()).toBe(false);
        expect(storage.has(COUNT_KEY)).toBe(false);

        vi.advanceTimersByTime(1500);
        expect(isHint()).toBe(true);
        expect(storage.get(COUNT_KEY)).toBe('1');
    });

    it('刚好 3 次也是停下之后才弹', async () => {
        const { isHint, clickTimes } = await load();
        clickTimes(3);
        expect(isHint()).toBe(false);
        vi.advanceTimersByTime(1500);
        expect(isHint()).toBe(true);
        expect(storage.get(COUNT_KEY)).toBe('1');
    });

    it('连点停下后又隔很久再连点：各算一次，两次额度用完后不再弹', async () => {
        const { useStatusMessageStore, isHint, clickTimes } = await load();
        clickTimes(4);
        vi.advanceTimersByTime(1500);
        expect(isHint()).toBe(true);

        useStatusMessageStore.getState().setMessage(null);
        vi.advanceTimersByTime(10_000);
        clickTimes(4);
        vi.advanceTimersByTime(1500);
        expect(isHint()).toBe(true);
        expect(storage.get(COUNT_KEY)).toBe('2');

        useStatusMessageStore.getState().setMessage(null);
        vi.advanceTimersByTime(10_000);
        clickTimes(7);
        vi.advanceTimersByTime(5000);
        expect(isHint()).toBe(false);
        expect(storage.get(COUNT_KEY)).toBe('2');
    });

    it('点击间隔超过 1.5 秒不算连点，永远不弹', async () => {
        const { isHint, click } = await load();
        click();
        click(1600);
        click(1600);
        click(1600);
        click(1600);
        vi.advanceTimersByTime(10_000);
        expect(isHint()).toBe(false);
        expect(storage.has(COUNT_KEY)).toBe(false);

        // 前两下贴着、第三下隔太久：从第三下重新数。
        click(200);
        click(200);
        click(2000);
        vi.advanceTimersByTime(10_000);
        expect(isHint()).toBe(false);
        expect(storage.has(COUNT_KEY)).toBe(false);
    });

    it('恰好 1.5 秒的间隔仍算连点', async () => {
        const { isHint, click } = await load();
        click();
        click(1500);
        click(1500);
        vi.advanceTimersByTime(1500);
        expect(isHint()).toBe(true);
    });

    it('累计次数跨会话：已用 1 次还能弹 1 次，已用 2 次永不再弹', async () => {
        storage.set(COUNT_KEY, '1');
        const first = await load();
        first.clickTimes(4);
        vi.advanceTimersByTime(1500);
        expect(first.isHint()).toBe(true);
        expect(storage.get(COUNT_KEY)).toBe('2');

        vi.resetModules();
        const reloaded = await load();
        reloaded.clickTimes(7);
        vi.advanceTimersByTime(10_000);
        expect(reloaded.isHint()).toBe(false);
        expect(storage.get(COUNT_KEY)).toBe('2');
    });

    it('额度已用尽时不弹也不改计数', async () => {
        storage.set(COUNT_KEY, '2');
        const { isHint, clickTimes } = await load();
        clickTimes(4);
        vi.advanceTimersByTime(10_000);
        expect(isHint()).toBe(false);
        expect(storage.get(COUNT_KEY)).toBe('2');
    });

    it('关掉思索提示时不弹也不计数', async () => {
        const { usePonderStore, isHint, clickTimes } = await load();
        usePonderStore.setState({ ponderHintVisibility: 'off' });
        clickTimes(7);
        vi.advanceTimersByTime(10_000);
        expect(isHint()).toBe(false);
        expect(storage.has(COUNT_KEY)).toBe(false);
    });

    it('等待期间关掉思索提示：呈现那一刻再判断，不弹也不计数', async () => {
        const { usePonderStore, isHint, clickTimes } = await load();
        clickTimes(4);
        usePonderStore.setState({ ponderHintVisibility: 'off' });
        vi.advanceTimersByTime(10_000);
        expect(isHint()).toBe(false);
        expect(storage.has(COUNT_KEY)).toBe(false);
    });

    it('教程会话开着时不弹也不计数', async () => {
        const { usePonderStore, isHint, clickTimes } = await load();
        usePonderStore.getState().openPonder('queue-shuffle');
        clickTimes(4);
        vi.advanceTimersByTime(10_000);
        expect(isHint()).toBe(false);
        expect(storage.has(COUNT_KEY)).toBe(false);
    });

    it('等待期间来了错误提示或常驻确认提示：不盖掉它，也不计数', async () => {
        const { useStatusMessageStore, message, isHint, clickTimes } = await load();
        clickTimes(4);
        useStatusMessageStore.getState().setMessage({ type: 'error', text: 'boom' });
        vi.advanceTimersByTime(1500);
        expect(isHint()).toBe(false);
        expect(message()?.text).toBe('boom');
        expect(storage.has(COUNT_KEY)).toBe(false);

        clickTimes(4);
        useStatusMessageStore.getState().setMessage({ type: 'info', text: 'confirm', persistent: true });
        vi.advanceTimersByTime(1500);
        expect(message()?.text).toBe('confirm');
        expect(storage.has(COUNT_KEY)).toBe(false);
    });

    it('点提示进入 queue-shuffle 思索', async () => {
        const { useStatusMessageStore, usePonderStore, clickTimes } = await load();
        clickTimes(4);
        vi.advanceTimersByTime(1500);
        useStatusMessageStore.getState().message?.onAction?.();
        expect(usePonderStore.getState().session?.targetId).toBe('queue-shuffle');
        expect(useStatusMessageStore.getState().message).toBeNull();
    });
});
