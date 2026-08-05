// src/components/app/playback/shuffleOrder.ts
// 随机播放的路线图模型：进入随机模式时一次性铺出本轮顺序，之后只沿着它走。
//
// 相比"每次现算随机"，序列预先确定带来三个能力：
//   1. 下一首可预知 —— 预取才有意义
//   2. 状态可序列化 —— 重启后接得上原来的随机顺序
//   3. 可插队 —— "下一首播放"能真正插到下一首

import type { PlayerLoopMode } from '../../../types';

export const isShuffleLoopMode = (mode: PlayerLoopMode): boolean => mode === 'shuffle';

/** 走到队列尽头后是否环绕回队列另一端。随机播放与列表循环共享这个语义。 */
export const wrapsAroundQueue = (mode: PlayerLoopMode): boolean => mode === 'all' || mode === 'shuffle';

export type ShuffleOrderState = {
    // 本轮的完整播放顺序，元素是 getPlaybackSongKey 产出的稳定键。
    order: string[];
    // 当前播到 order 的哪一项；-1 表示还没开始。
    cursor: number;
    // "下一首播放"插队，优先于 order 消费。
    pendingNext: string[];
};

export const createShuffleOrderState = (): ShuffleOrderState => ({
    order: [],
    cursor: -1,
    pendingNext: [],
});

type ShuffleAdvanceInput = {
    state: ShuffleOrderState;
    queueKeys: string[];
    currentKey: string | null;
    // 注入随机源便于测试；返回 [0, 1) 之间的小数。
    random: () => number;
};

type ShuffleAdvanceResult = {
    nextKey: string | null;
    state: ShuffleOrderState;
};

const shuffled = (keys: string[], random: () => number): string[] => {
    const result = [...keys];
    for (let index = result.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(random() * (index + 1));
        [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
};

/** 铺一条新路线图，把当前歌放在开头，保证 cursor 之后都是没播过的。 */
const buildOrder = (queueKeys: string[], currentKey: string | null, random: () => number): ShuffleOrderState => {
    const rest = currentKey ? queueKeys.filter(key => key !== currentKey) : queueKeys;
    const order = currentKey && queueKeys.includes(currentKey)
        ? [currentKey, ...shuffled(rest, random)]
        : shuffled(queueKeys, random);

    return {
        order,
        cursor: currentKey && queueKeys.includes(currentKey) ? 0 : -1,
        pendingNext: [],
    };
};

/**
 * 让路线图跟上队列的增删。
 * 已播过的部分保持原样，新歌插进剩余部分，移除的歌从路线图消失。
 */
export const syncShuffleOrderWithQueue = (
    state: ShuffleOrderState,
    queueKeys: string[],
    currentKey: string | null,
    random: () => number,
): ShuffleOrderState => {
    if (queueKeys.length === 0) {
        return createShuffleOrderState();
    }

    const queueKeySet = new Set(queueKeys);
    const retained: string[] = [];
    let cursor = -1;

    state.order.forEach((key, index) => {
        if (!queueKeySet.has(key)) {
            return;
        }
        retained.push(key);
        if (index <= state.cursor) {
            cursor = retained.length - 1;
        }
    });

    // 与旧队列毫无交集，说明整个队列被换掉了。
    if (retained.length === 0) {
        return buildOrder(queueKeys, currentKey, random);
    }

    const retainedSet = new Set(retained);
    const added = queueKeys.filter(key => !retainedSet.has(key));
    if (added.length === 0) {
        return {
            order: retained,
            cursor,
            pendingNext: state.pendingNext.filter(key => queueKeySet.has(key)),
        };
    }

    // 新歌落在 cursor 之后的随机位置，本轮就能被播到。
    const head = retained.slice(0, cursor + 1);
    const tail = shuffled([...retained.slice(cursor + 1), ...added], random);

    return {
        order: [...head, ...tail],
        cursor,
        pendingNext: state.pendingNext.filter(key => queueKeySet.has(key)),
    };
};

/** 预告下一首播哪个，不改状态。预取用它来提前拉音频。 */
export const peekNextShuffleKey = (state: ShuffleOrderState): string | null => {
    if (state.pendingNext.length > 0) {
        return state.pendingNext[0];
    }

    return state.order[state.cursor + 1] ?? null;
};

/** 取路线图上接下来的若干首，供预取按真实播放顺序拉取。 */
export const getUpcomingShuffleKeys = (state: ShuffleOrderState, count: number): string[] => {
    const upcoming = [
        ...state.pendingNext,
        ...state.order.slice(state.cursor + 1),
    ];

    // 插队歌可能同时还留在路线图里，去重后再截断。
    return [...new Set(upcoming)].slice(0, Math.max(0, count));
};

/** 把一首歌插到下一首播放的位置。重复插入同一首不会产生两条记录。 */
export const enqueueShuffleNext = (state: ShuffleOrderState, key: string): ShuffleOrderState => {
    if (state.pendingNext.includes(key)) {
        return state;
    }

    return { ...state, pendingNext: [...state.pendingNext, key] };
};

export const advanceShuffleOrder = ({
    state,
    queueKeys,
    currentKey,
    random,
}: ShuffleAdvanceInput): ShuffleAdvanceResult => {
    if (queueKeys.length === 0) {
        return { nextKey: null, state: createShuffleOrderState() };
    }

    if (queueKeys.length === 1) {
        return { nextKey: queueKeys[0], state: { order: [queueKeys[0]], cursor: 0, pendingNext: [] } };
    }

    const synced = state.order.length === 0
        ? buildOrder(queueKeys, currentKey, random)
        : syncShuffleOrderWithQueue(state, queueKeys, currentKey, random);

    // 插队优先。播过之后把它并入路线图，这样上一首仍能沿原路回退。
    if (synced.pendingNext.length > 0) {
        const [nextKey, ...restPending] = synced.pendingNext;
        const withoutKey = synced.order.filter(key => key !== nextKey);
        // 移除的位置若在 cursor 之前，cursor 要跟着前移一位。
        const removedIndex = synced.order.indexOf(nextKey);
        const cursor = removedIndex >= 0 && removedIndex <= synced.cursor ? synced.cursor - 1 : synced.cursor;
        const order = [...withoutKey.slice(0, cursor + 1), nextKey, ...withoutKey.slice(cursor + 1)];

        return {
            nextKey,
            state: { order, cursor: cursor + 1, pendingNext: restPending },
        };
    }

    const nextIndex = synced.cursor + 1;
    if (nextIndex < synced.order.length) {
        return {
            nextKey: synced.order[nextIndex],
            state: { ...synced, cursor: nextIndex },
        };
    }

    // 本轮走完，铺新一轮；两首以上时不让新一轮开头重复刚播完的那首。
    const nextRound = buildOrder(queueKeys, null, random);
    if (nextRound.order[0] === currentKey && nextRound.order.length > 1) {
        [nextRound.order[0], nextRound.order[1]] = [nextRound.order[1], nextRound.order[0]];
    }

    return {
        nextKey: nextRound.order[0] ?? null,
        state: { ...nextRound, cursor: 0 },
    };
};

/**
 * 沿路线图回退。
 * 没有可回退的位置时返回 null，由调用方决定是否退化成队列上一首。
 */
export const rewindShuffleOrder = (
    state: ShuffleOrderState,
    queueKeys: string[],
): ShuffleAdvanceResult => {
    const queueKeySet = new Set(queueKeys);
    const retained: string[] = [];
    let cursor = -1;

    state.order.forEach((key, index) => {
        if (!queueKeySet.has(key)) {
            return;
        }
        retained.push(key);
        if (index <= state.cursor) {
            cursor = retained.length - 1;
        }
    });

    if (cursor <= 0) {
        return {
            nextKey: null,
            state: { order: retained, cursor: Math.max(cursor, -1), pendingNext: state.pendingNext },
        };
    }

    return {
        nextKey: retained[cursor - 1],
        state: { order: retained, cursor: cursor - 1, pendingNext: state.pendingNext },
    };
};

/** 从持久化数据还原，字段损坏时退回空状态而不是抛错。 */
export const parseShuffleOrderState = (raw: unknown): ShuffleOrderState => {
    if (!raw || typeof raw !== 'object') {
        return createShuffleOrderState();
    }

    const candidate = raw as Partial<ShuffleOrderState>;
    if (!Array.isArray(candidate.order) || typeof candidate.cursor !== 'number') {
        return createShuffleOrderState();
    }

    const order = candidate.order.filter((key): key is string => typeof key === 'string');
    const pendingNext = Array.isArray(candidate.pendingNext)
        ? candidate.pendingNext.filter((key): key is string => typeof key === 'string')
        : [];

    return {
        order,
        cursor: Math.min(Math.max(candidate.cursor, -1), order.length - 1),
        pendingNext,
    };
};
