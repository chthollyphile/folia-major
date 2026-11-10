import type { RemoteQueueItem } from '../../types/remoteControl';
import { normalizeSearchText, splitWords } from '../command-palette/search/normalize';

// src/components/remote/remoteQueueSearch.ts
// The remote queue's search: a row matches when every word typed is in its search text (which the
// main window built with the command palette's queue index, so the same words find the same songs).

/** The queue positions of the rows that match `query`, in queue order; every row for an empty query. */
export const filterRemoteQueue = (items: readonly RemoteQueueItem[], query: string): number[] => {
    const words = splitWords(normalizeSearchText(query));
    const matches: number[] = [];
    items.forEach((item, index) => {
        if (words.every(word => item.searchText.includes(word))) {
            matches.push(index);
        }
    });
    return matches;
};
