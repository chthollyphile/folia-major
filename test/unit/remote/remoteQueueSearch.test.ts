import { describe, expect, it } from 'vitest';
import { filterRemoteQueue } from '../../../src/components/remote/remoteQueueSearch';
import type { RemoteQueueItem } from '../../../src/types/remoteControl';

// test/unit/remote/remoteQueueSearch.test.ts
// The remote queue's search: every word typed has to be in a row's search text.

const item = (key: string, searchText: string): RemoteQueueItem => ({ key, title: key, artist: '', tag: '', searchText });

const items = [
    item('a', '1 blue bird ikimono-gakari'),
    item('b', '2 silhouette kana-boon'),
    item('c', '3 blue light ikimono-gakari'),
];

describe('filterRemoteQueue', () => {
    it('returns every row for an empty or blank query', () => {
        expect(filterRemoteQueue(items, '')).toEqual([0, 1, 2]);
        expect(filterRemoteQueue(items, '   ')).toEqual([0, 1, 2]);
    });

    it('needs every word, in any order, ignoring case and spacing', () => {
        expect(filterRemoteQueue(items, 'Blue')).toEqual([0, 2]);
        expect(filterRemoteQueue(items, '  IKIMONO   light ')).toEqual([2]);
        expect(filterRemoteQueue(items, 'blue boon')).toEqual([]);
    });

    it('finds a row by its queue position', () => {
        expect(filterRemoteQueue(items, '2 silhouette')).toEqual([1]);
    });
});
