import { describe, expect, it } from 'vitest';
import type { SongResult } from '../../../src/types';
import { applyQueueBatchOperation } from '../../../src/utils/queueBatchOperations';

// test/unit/utils/queueBatchOperations.test.ts
// Covers atomic batch ordering, duplicate occurrences, and current-song protection.

const song = (id: number, name = String(id)): SongResult => ({
    id,
    name,
    artists: [],
    album: { id: 1, name: 'Album' },
    durationMs: 1000,
});

describe('queue batch operations', () => {
    it('removes targets atomically while protecting the current song', () => {
        const queue = [song(1), song(2), song(3)];
        const result = applyQueueBatchOperation({
            queue,
            targetIndices: [0, 2],
            currentSong: queue[0],
            action: 'remove',
        });

        expect(result.nextQueue.map(item => item.id)).toEqual([1, 2]);
        expect(result.affectedCount).toBe(1);
        expect(result.skippedCurrentCount).toBe(1);
    });

    it('moves matches after the current song in original queue order', () => {
        const queue = [song(1), song(2), song(3), song(4), song(5)];
        const result = applyQueueBatchOperation({
            queue,
            targetIndices: [3, 1],
            currentSong: queue[0],
            action: 'next',
        });

        expect(result.nextQueue.map(item => item.id)).toEqual([1, 2, 4, 3, 5]);
    });

    it('moves duplicate occurrences independently to the queue end', () => {
        const duplicate = song(2, 'Duplicate');
        const queue = [song(1), duplicate, song(3), duplicate, song(4)];
        const result = applyQueueBatchOperation({
            queue,
            targetIndices: [1],
            currentSong: queue[0],
            action: 'end',
        });

        expect(result.nextQueue).toEqual([queue[0], queue[2], queue[3], queue[4], queue[1]]);
        expect(result.affectedCount).toBe(1);
    });

    // Elsewhere the current song is the first entry with its key (queueIndexOf). Here the entry
    // that is the very object playing wins, and the key only decides when no entry is that object.
    it('takes the playing object as the current entry when the same song is queued twice', () => {
        const first = song(1, 'first entry');
        const second = song(1, 'second entry');
        const queue = [first, song(2), second, song(3)];

        const removed = applyQueueBatchOperation({ queue, targetIndices: [0, 2], currentSong: second, action: 'remove' });
        expect(removed.nextQueue).toEqual([queue[1], second, queue[3]]);
        expect(removed.skippedCurrentCount).toBe(1);

        const movedNext = applyQueueBatchOperation({ queue, targetIndices: [3], currentSong: second, action: 'next' });
        expect(movedNext.nextQueue).toEqual([first, queue[1], second, queue[3]]);
        expect(movedNext.changed).toBe(false);

        // A copy of the song that is no entry of the queue: the first entry with its key.
        const byKey = applyQueueBatchOperation({ queue, targetIndices: [0, 2], currentSong: song(1), action: 'remove' });
        expect(byKey.nextQueue).toEqual([first, queue[1], queue[3]]);
        expect(byKey.skippedCurrentCount).toBe(1);
    });

    it('reports no change when only the current song is targeted', () => {
        const queue = [song(1), song(2)];
        const result = applyQueueBatchOperation({
            queue,
            targetIndices: [0],
            currentSong: queue[0],
            action: 'remove',
        });

        expect(result.changed).toBe(false);
        expect(result.nextQueue).toBe(queue);
    });
});
