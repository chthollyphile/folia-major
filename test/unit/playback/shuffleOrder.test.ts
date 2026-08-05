import { describe, expect, it } from 'vitest';
import {
    advanceShuffleOrder,
    createShuffleOrderState,
    enqueueShuffleNext,
    peekNextShuffleKey,
    rewindShuffleOrder,
    syncShuffleOrderWithQueue,
} from '@/components/app/playback/shuffleOrder';

// test/unit/playback/shuffleOrder.test.ts
// 随机播放采用"一轮内序列预先确定"的路线图模型：
// 序列可预知（预取才有意义）、可持久化（重启接得上）、可插队（下一首播放）。

const queue = ['a', 'b', 'c', 'd'];

// 固定随机源，避免测试依赖 Math.random。
const fixedRandom = (value: number) => () => value;

const buildOrder = (currentKey: string | null = 'a', random = fixedRandom(0)) => (
    syncShuffleOrderWithQueue(createShuffleOrderState(), queue, currentKey, random)
);

describe('syncShuffleOrderWithQueue', () => {
    it('首次进入随机模式时铺出覆盖整个队列的路线图', () => {
        const state = buildOrder();

        expect([...state.order].sort()).toEqual(queue);
        expect(state.order[0]).toBe('a');
        expect(state.cursor).toBe(0);
    });

    it('新歌加入队列后进入本轮剩余部分，不必等下一轮', () => {
        const state = buildOrder();
        const next = syncShuffleOrderWithQueue(state, [...queue, 'e'], 'a', fixedRandom(0));

        expect(next.order).toContain('e');
        expect(next.order.indexOf('e')).toBeGreaterThan(next.cursor);
    });

    it('歌曲移出队列后从路线图中消失，且不打乱已播位置', () => {
        const state = { order: ['a', 'b', 'c', 'd'], cursor: 1, pendingNext: [] };
        const next = syncShuffleOrderWithQueue(state, ['a', 'b', 'd'], 'b', fixedRandom(0));

        expect(next.order).not.toContain('c');
        expect(next.order[next.cursor]).toBe('b');
    });

    it('队列整体换掉时重新铺路线图', () => {
        const state = { order: ['a', 'b'], cursor: 0, pendingNext: [] };
        const next = syncShuffleOrderWithQueue(state, ['x', 'y'], 'x', fixedRandom(0));

        expect([...next.order].sort()).toEqual(['x', 'y']);
    });
});

describe('peekNextShuffleKey', () => {
    it('预告的下一首必须等于实际推进到的那一首', () => {
        let state = buildOrder();

        for (let step = 0; step < 3; step += 1) {
            const predicted = peekNextShuffleKey(state);
            const result = advanceShuffleOrder({ state, queueKeys: queue, currentKey: null, random: fixedRandom(0) });

            expect(result.nextKey).toBe(predicted);
            state = result.state;
        }
    });

    it('插队后预告立刻改成插队的那一首', () => {
        const state = enqueueShuffleNext(buildOrder(), 'd');

        expect(peekNextShuffleKey(state)).toBe('d');
    });
});

describe('enqueueShuffleNext', () => {
    it('插队的歌必须是下一首播放的', () => {
        const state = enqueueShuffleNext(buildOrder(), 'd');
        const result = advanceShuffleOrder({ state, queueKeys: queue, currentKey: 'a', random: fixedRandom(0) });

        expect(result.nextKey).toBe('d');
    });

    it('连续插队按点击先后播放', () => {
        let state = enqueueShuffleNext(buildOrder(), 'd');
        state = enqueueShuffleNext(state, 'c');

        const first = advanceShuffleOrder({ state, queueKeys: queue, currentKey: 'a', random: fixedRandom(0) });
        expect(first.nextKey).toBe('d');

        const second = advanceShuffleOrder({ state: first.state, queueKeys: queue, currentKey: 'd', random: fixedRandom(0) });
        expect(second.nextKey).toBe('c');
    });

    it('插队过的歌不会在本轮里再播一次', () => {
        let state = enqueueShuffleNext(buildOrder(), 'd');
        const played = ['a'];

        for (let step = 0; step < 3; step += 1) {
            const result = advanceShuffleOrder({ state, queueKeys: queue, currentKey: null, random: fixedRandom(0) });
            expect(played).not.toContain(result.nextKey);
            played.push(result.nextKey as string);
            state = result.state;
        }

        expect([...played].sort()).toEqual(queue);
    });

    it('重复插同一首不会产生两条记录', () => {
        let state = enqueueShuffleNext(buildOrder(), 'd');
        state = enqueueShuffleNext(state, 'd');

        expect(state.pendingNext).toEqual(['d']);
    });
});

describe('advanceShuffleOrder', () => {
    it('一轮内不重复', () => {
        let state = buildOrder();
        const played = ['a'];

        for (let step = 0; step < 3; step += 1) {
            const result = advanceShuffleOrder({ state, queueKeys: queue, currentKey: null, random: fixedRandom(0) });
            expect(played).not.toContain(result.nextKey);
            played.push(result.nextKey as string);
            state = result.state;
        }

        expect([...played].sort()).toEqual(queue);
    });

    it('一轮播完后重新铺路线图，且不紧接着重复刚播完的那首', () => {
        let state = buildOrder();
        let current: string | null = 'a';

        for (let step = 0; step < 3; step += 1) {
            const result = advanceShuffleOrder({ state, queueKeys: queue, currentKey: current, random: fixedRandom(0) });
            state = result.state;
            current = result.nextKey;
        }

        const wrapped = advanceShuffleOrder({ state, queueKeys: queue, currentKey: current, random: fixedRandom(0) });
        expect(wrapped.nextKey).not.toBe(current);
        expect([...wrapped.state.order].sort()).toEqual(queue);
    });

    it('单曲队列直接返回那一首', () => {
        const result = advanceShuffleOrder({
            state: createShuffleOrderState(),
            queueKeys: ['only'],
            currentKey: 'only',
            random: fixedRandom(0),
        });

        expect(result.nextKey).toBe('only');
    });

    it('空队列返回 null 并重置', () => {
        const result = advanceShuffleOrder({
            state: { order: ['a', 'b'], cursor: 1, pendingNext: [] },
            queueKeys: [],
            currentKey: 'a',
            random: fixedRandom(0),
        });

        expect(result.nextKey).toBeNull();
        expect(result.state).toEqual(createShuffleOrderState());
    });
});

describe('rewindShuffleOrder', () => {
    it('沿路线图回退到上一首', () => {
        const result = rewindShuffleOrder({ order: ['a', 'b', 'c'], cursor: 2, pendingNext: [] }, ['a', 'b', 'c']);

        expect(result.nextKey).toBe('b');
        expect(result.state.cursor).toBe(1);
    });

    it('插队播放后回退仍能回到插队前那一首', () => {
        const state = enqueueShuffleNext(buildOrder(), 'd');
        const played = advanceShuffleOrder({ state, queueKeys: queue, currentKey: 'a', random: fixedRandom(0) });

        expect(played.nextKey).toBe('d');
        expect(rewindShuffleOrder(played.state, queue).nextKey).toBe('a');
    });

    it('已在路线图开头时返回 null，交给调用方决定退化行为', () => {
        expect(rewindShuffleOrder({ order: ['a'], cursor: 0, pendingNext: [] }, queue).nextKey).toBeNull();
        expect(rewindShuffleOrder(createShuffleOrderState(), queue).nextKey).toBeNull();
    });
});

describe('跨会话恢复', () => {
    it('序列化再读回后，下一首与重启前预告的一致', () => {
        const state = buildOrder();
        const predicted = peekNextShuffleKey(state);

        const restored = JSON.parse(JSON.stringify(state));
        const result = advanceShuffleOrder({ state: restored, queueKeys: queue, currentKey: null, random: fixedRandom(0) });

        expect(result.nextKey).toBe(predicted);
    });
});
