import { describe, expect, it } from 'vitest';
import type { SongResult } from '../../../src/types';
import { canSaveQueueAsPlaylist, moveQueueItem, moveQueueItemToNext } from '../../../src/utils/queueReorder';

// test/unit/utils/queueReorder.test.ts
// 队列单项移动（拖拽排序与 Electron 舞台 move 共用）、「下一首播放」的挪动与「能不能存成本地歌单」的判定。

const onlineSong = (id: number): SongResult => ({
    id,
    name: `Online ${id}`,
    artists: [],
    album: { id: 1, name: 'Album' },
    durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: String(id) },
} as SongResult);

const localSong = (id: number): SongResult => ({
    id,
    name: `Local ${id}`,
    artists: [],
    album: { id: 1, name: 'Album' },
    durationMs: 1000,
    isLocal: true,
    localRef: { songId: `local-${id}` },
} as unknown as SongResult);

describe('moveQueueItem', () => {
    it('moves an item down and up, `to` being its index after the move', () => {
        expect(moveQueueItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
        expect(moveQueueItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
        expect(moveQueueItem(['a', 'b', 'c', 'd'], 1, 3)).toEqual(['a', 'c', 'd', 'b']);
    });

    it('returns the same array for a no-op or an out-of-range index and never mutates the input', () => {
        const queue = ['a', 'b', 'c'];
        expect(moveQueueItem(queue, 1, 1)).toBe(queue);
        expect(moveQueueItem(queue, -1, 1)).toBe(queue);
        expect(moveQueueItem(queue, 0, 3)).toBe(queue);
        expect(moveQueueItem(queue, 1.5, 0)).toBe(queue);
        expect(moveQueueItem([], 0, 0)).toEqual([]);
        const moved = moveQueueItem(queue, 0, 2);
        expect(moved).not.toBe(queue);
        expect(queue).toEqual(['a', 'b', 'c']);
    });
});

describe('moveQueueItemToNext', () => {
    it('lands right after the current item, including when the current item is last', () => {
        // 当前在队尾：[a b c] 播 c，把 a 挪到下一首 → [b c a]（不是 [b a c]）。
        expect(moveQueueItemToNext(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
        expect(moveQueueItemToNext(['a', 'b', 'c', 'd', 'e'], 4, 1)).toEqual(['a', 'b', 'e', 'c', 'd']);
        expect(moveQueueItemToNext(['a', 'b', 'c', 'd', 'e'], 0, 3)).toEqual(['b', 'c', 'd', 'a', 'e']);
    });

    it('moves to the front when there is no current item', () => {
        expect(moveQueueItemToNext(['a', 'b', 'c'], 2, -1)).toEqual(['c', 'a', 'b']);
        const queue = ['a', 'b', 'c'];
        expect(moveQueueItemToNext(queue, 0, -1)).toBe(queue);
    });

    it('returns the same array for the current item, the item already next, or an out-of-range index', () => {
        const queue = ['a', 'b', 'c', 'd'];
        expect(moveQueueItemToNext(queue, 1, 1)).toBe(queue);
        expect(moveQueueItemToNext(queue, 2, 1)).toBe(queue);
        expect(moveQueueItemToNext(queue, 4, 1)).toBe(queue);
        expect(moveQueueItemToNext(queue, -1, 1)).toBe(queue);
        expect(queue).toEqual(['a', 'b', 'c', 'd']);
    });
});

describe('canSaveQueueAsPlaylist', () => {
    it('needs a current song and a non-empty queue', () => {
        const queue = [localSong(1), localSong(2)];
        expect(canSaveQueueAsPlaylist(queue[0], queue)).toBe(true);
        expect(canSaveQueueAsPlaylist(queue[0], [])).toBe(false);
        expect(canSaveQueueAsPlaylist(null, queue)).toBe(false);
    });

    it('takes a queue of any source, mixed ones too', () => {
        expect(canSaveQueueAsPlaylist(onlineSong(9), [onlineSong(9), onlineSong(10)])).toBe(true);
        expect(canSaveQueueAsPlaylist(localSong(1), [localSong(1), onlineSong(2)])).toBe(true);
    });

    it('refuses a queue of nothing but stage songs, which belong to no source', () => {
        const stage = { ...onlineSong(3), isStage: true } as ReturnType<typeof onlineSong>;
        expect(canSaveQueueAsPlaylist(stage, [stage])).toBe(false);
        expect(canSaveQueueAsPlaylist(stage, [stage, localSong(1)])).toBe(true);
    });
});
