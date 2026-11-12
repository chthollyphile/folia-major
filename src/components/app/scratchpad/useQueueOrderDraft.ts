import { useEffect, useMemo, useRef, useState } from 'react';
import type { SongResult } from '../../../types';
import { usePlaybackStore } from '../../../stores/usePlaybackStore';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import { rebaseOrder } from './queueOrder';

// src/components/app/scratchpad/useQueueOrderDraft.ts
// 速记簿「播放队列」展开视图里拖动排序的草稿：松手只改这里的顺序（界面马上按它画），等用户停手一会儿
// （QUEUE_SETTLE_MS 之内没再拖）才一次写进播放队列。队列一变，Lattice 等订阅队列的画面就要重排一遍；连着拖几下
// 只提交一次，免得它们跟着每一下重渲染。
// - 又开始拖（hold）时计时停下，松手（place）再重新计时；拖了又没放下（放回原处、Esc、取消）时 resume 接着计时；
// - 草稿记着它是从哪一份队列改出来的（base）。队列换了一份时：按播放键还是同一串（开播一首都会把正在播的那首换成
//   新对象，顺序没变）就把草稿接到新的那份上（rebaseOrder）；顺序真的变了（入队、移除、换歌单）就放弃草稿，不盖掉
//   别人的改动，界面随即换回真实的队列；
// - flush 立刻提交（点歌之前、离开这一页时）；卸载时也 flush。批量操作在草稿顺序上算好、自己一次写进队列，
//   之前先 discard 掉草稿（不然算完的队列与草稿出发时按播放键同一串时，草稿会接上，到点又把批量操作盖掉）。
// 计时与接续的规则在不依赖 React 的 createQueueOrderDraft 里（单测直接测），hook 只把它接到 store 与组件上。

/** 停手多久才提交（ms）。 */
export const QUEUE_SETTLE_MS = 700;

export type QueueDraft = { base: SongResult[]; order: SongResult[] };

type QueueOrderDraftDeps = {
    /** 此刻的播放队列。 */
    readQueue: () => SongResult[];
    commit: (order: SongResult[]) => void;
    /** 草稿变了（含清掉）。 */
    onChange: (draft: QueueDraft | null) => void;
    settleMs?: number;
};

const keyOf = (song: SongResult) => getPlaybackSongKey(song);

/** 草稿的状态机：放下、停表、跟上队列、提交。 */
export const createQueueOrderDraft = ({ readQueue, commit, onChange, settleMs = QUEUE_SETTLE_MS }: QueueOrderDraftDeps) => {
    let draft: QueueDraft | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const set = (next: QueueDraft | null) => {
        draft = next;
        onChange(next);
    };
    const stopTimer = () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
    };

    /** 草稿跟上这一份队列：接得上就接，接不上就放弃。返回跟上之后的草稿。 */
    const sync = (queue: SongResult[]): QueueDraft | null => {
        if (!draft || draft.base === queue) return draft;
        const order = rebaseOrder(draft.base, draft.order, queue, keyOf);
        if (order) {
            set({ base: queue, order });
        } else {
            console.info('[Scratchpad] queue changed elsewhere, dropping the reorder draft');
            stopTimer();
            set(null);
        }
        return draft;
    };

    const flush = () => {
        stopTimer();
        const current = sync(readQueue());
        if (!current) return;
        set(null);
        console.info('[Scratchpad] commit queue reorder', { length: current.order.length });
        commit(current.order);
    };

    /** 松手：换成这个顺序（它是从眼下的草稿或队列改出来的），重新计时。 */
    const place = (order: SongResult[]) => {
        const queue = readQueue();
        const from = draft?.base ?? queue;
        const rebased = rebaseOrder(from, order, queue, keyOf);
        if (!rebased) {
            console.info('[Scratchpad] queue changed during the drag, dropping it');
            stopTimer();
            set(null);
            return;
        }
        set({ base: queue, order: rebased });
        stopTimer();
        timer = setTimeout(flush, settleMs);
    };

    /** 拖动结束了却没放下：有草稿又没在计时的话，接着计时。 */
    const resume = () => {
        if (draft && timer === null) timer = setTimeout(flush, settleMs);
    };

    /** 放弃草稿，不提交。 */
    const discard = () => {
        stopTimer();
        if (draft) set(null);
    };

    return {
        place,
        hold: stopTimer,
        resume,
        discard,
        flush,
        sync,
        get draft() {
            return draft;
        },
    };
};

export type QueueOrderDraft = {
    /** 界面上画的顺序：有草稿时是草稿，否则是真实的队列。 */
    order: SongResult[];
    /** 有还没提交的草稿。 */
    isPending: boolean;
    /** 松手：换成这个顺序，重新开始计时。 */
    place: (order: SongResult[]) => void;
    /** 又按下开始拖：计时先停。 */
    hold: () => void;
    /** 拖动结束了却没放下：接着计时。 */
    resume: () => void;
    /** 放弃草稿，不提交（批量操作自己写进队列之前）。 */
    discard: () => void;
    /** 立刻提交（没有草稿时什么都不做）。 */
    flush: () => void;
};

export const useQueueOrderDraft = (
    playQueue: SongResult[],
    commit: (order: SongResult[]) => void,
): QueueOrderDraft => {
    const [draft, setDraft] = useState<QueueDraft | null>(null);
    const commitRef = useRef(commit);
    commitRef.current = commit;
    const [controller] = useState(() => createQueueOrderDraft({
        readQueue: () => usePlaybackStore.getState().playQueue,
        commit: order => commitRef.current(order),
        onChange: setDraft,
    }));

    // 队列换了一份：草稿接上或作废（提交之后队列也会变，那时草稿已经清掉了）。
    useEffect(() => {
        controller.sync(playQueue);
    }, [controller, playQueue]);

    // 离开这一页、收起抽屉：还没提交的草稿这就提交。
    useEffect(() => () => controller.flush(), [controller]);

    // 队列刚换、effect 还没跑的这一次渲染：先按接得上的样子画，接不上就画真实的队列。
    const order = useMemo(() => {
        if (!draft) return playQueue;
        if (draft.base === playQueue) return draft.order;
        return rebaseOrder(draft.base, draft.order, playQueue, keyOf) ?? playQueue;
    }, [draft, playQueue]);

    return {
        order,
        isPending: draft !== null,
        place: controller.place,
        hold: controller.hold,
        resume: controller.resume,
        discard: controller.discard,
        flush: controller.flush,
    };
};
