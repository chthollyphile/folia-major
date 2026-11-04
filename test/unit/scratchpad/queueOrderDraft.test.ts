import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '../../../src/types';
import { createQueueOrderDraft, QUEUE_SETTLE_MS } from '../../../src/components/app/scratchpad/useQueueOrderDraft';

// test/unit/scratchpad/queueOrderDraft.test.ts
// 速记簿「播放队列」拖动排序的草稿：停手才提交、再按下停表、队列只换了对象时接上、真被改了时放弃、flush 立刻提交。

const song = (id: string): SongResult => ({
    id: 0,
    name: id,
    artists: [],
    album: { id: 0, name: '' },
    localRef: { songId: id },
    sourceRef: { kind: 'local', mediaId: id },
} as unknown as SongResult);

const names = (songs: readonly SongResult[] | undefined) => songs?.map(item => item.name);

describe('createQueueOrderDraft', () => {
    let queue: SongResult[];
    let commits: SongResult[][];
    const make = () => createQueueOrderDraft({
        readQueue: () => queue,
        commit: order => {
            commits.push(order);
            queue = order;
        },
        onChange: () => undefined,
    });

    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
        queue = ['a', 'b', 'c'].map(song);
        commits = [];
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('commits once, after the hand has been still for a while', () => {
        const draft = make();
        draft.place([queue[1], queue[0], queue[2]]);
        vi.advanceTimersByTime(QUEUE_SETTLE_MS - 1);
        expect(commits).toHaveLength(0);
        draft.place([queue[2], queue[1], queue[0]]);
        vi.advanceTimersByTime(QUEUE_SETTLE_MS - 1);
        expect(commits).toHaveLength(0);
        vi.advanceTimersByTime(1);
        expect(commits.map(names)).toEqual([['c', 'b', 'a']]);
        expect(draft.draft).toBeNull();
    });

    it('stops the clock while a new drag is held', () => {
        const draft = make();
        draft.place([queue[1], queue[0], queue[2]]);
        draft.hold();
        vi.advanceTimersByTime(QUEUE_SETTLE_MS * 3);
        expect(commits).toHaveLength(0);
        draft.flush();
        expect(commits.map(names)).toEqual([['b', 'a', 'c']]);
    });

    it('carries the draft over when the queue only swapped an entry for a new object', () => {
        const draft = make();
        const [a, b, c] = queue;
        draft.place([c, a, b]);
        // 开播一首：正在播的那首换成新对象，顺序不变。
        const freshA = song('a');
        queue = [freshA, b, c];
        draft.sync(queue);
        vi.advanceTimersByTime(QUEUE_SETTLE_MS);
        expect(commits.map(names)).toEqual([['c', 'a', 'b']]);
        expect(commits[0][1]).toBe(freshA);
    });

    it('drops the draft when the queue really changed elsewhere', () => {
        const draft = make();
        const [a, b, c] = queue;
        draft.place([c, a, b]);
        queue = [a, b, c, song('d')];
        draft.sync(queue);
        expect(draft.draft).toBeNull();
        vi.advanceTimersByTime(QUEUE_SETTLE_MS);
        draft.flush();
        expect(commits).toHaveLength(0);
    });

    it('drops the draft at commit time when the queue changed and nobody synced it', () => {
        const draft = make();
        const [a, b, c] = queue;
        draft.place([c, a, b]);
        queue = [a, c];
        vi.advanceTimersByTime(QUEUE_SETTLE_MS);
        expect(commits).toHaveLength(0);
    });

    it('keeps counting after a drag that ended without a drop', () => {
        const draft = make();
        draft.place([queue[1], queue[0], queue[2]]);
        draft.hold();
        vi.advanceTimersByTime(QUEUE_SETTLE_MS * 2);
        draft.resume();
        expect(commits).toHaveLength(0);
        vi.advanceTimersByTime(QUEUE_SETTLE_MS);
        expect(commits.map(names)).toEqual([['b', 'a', 'c']]);
    });

    it('does not start a clock on resume without a draft, and discard drops the draft unsaved', () => {
        const draft = make();
        draft.resume();
        vi.advanceTimersByTime(QUEUE_SETTLE_MS);
        draft.place([queue[2], queue[0], queue[1]]);
        draft.discard();
        vi.advanceTimersByTime(QUEUE_SETTLE_MS * 2);
        draft.flush();
        expect(commits).toHaveLength(0);
        expect(draft.draft).toBeNull();
    });

    it('does nothing on flush without a draft', () => {
        const draft = make();
        draft.flush();
        expect(commits).toHaveLength(0);
    });
});
