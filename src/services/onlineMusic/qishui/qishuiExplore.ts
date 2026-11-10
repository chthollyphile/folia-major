import i18n from '../../../i18n/config';
import type { UnifiedSong } from '../../../types';
import type { OnlineExploreProvider, ProviderExploreItem } from '../../../types/onlineMusic';
import { createHandedOut, cursorWords, stampCursor } from '../exploreReads';
import { normalizeQishuiSong } from './qishuiNormalize';
import { requestQishui } from './qishuiTransport';

// Qishui's own recommendation stream, independent of the personal-FM queue.
let read = 0;
let batches = 0;
let handedOut = createHandedOut();
// The songs this read has handed out so far, across its "more" batches: nothing says the stream never repeats a
// song, and a read shows each song once. Belongs to one read only (EXPLORE_ADAPTER.md rule 10), so it stays here.
let shown = new Set<string>();
// How many stream requests one call makes at most while a batch brings only songs already shown.
const TRIES_PER_BATCH = 3;
export function clearQishuiExplore() { read++; batches = 0; handedOut = createHandedOut(); shown = new Set(); }
// The next songs of the stream that this read has not shown yet, in the shared turn order.
async function nextItems(first: boolean, mine: number): Promise<{ items: ProviderExploreItem[]; hasMore: boolean } | null> {
    const seen = shown;
    let hasMore = true;
    for (let attempt = 0; attempt < TRIES_PER_BATCH && hasMore; attempt++) {
        const data = await requestQishui<{ items: unknown[]; hasMore: boolean }>('feed', { queue: 'explore', first: first && attempt === 0, limit: 20 });
        if (mine !== read) return null;
        hasMore = data.hasMore;
        const fresh: UnifiedSong[] = [];
        for (const song of data.items.map(normalizeQishuiSong)) {
            const key = String(song.id);
            if (seen.has(key)) continue;
            seen.add(key);
            fresh.push(song);
        }
        if (!fresh.length) continue;
        const songs = handedOut.inTurn('stream', fresh, song => String(song.id));
        handedOut.note('stream', songs.map(song => String(song.id)));
        return { items: songs.map(song => ({ kind: 'song', song })), hasMore };
    }
    return { items: [], hasMore: false };
}
export const qishuiExplore: OnlineExploreProvider = {
    async getFeed(cursor) {
        if (cursor) return { sections: [] };
        const mine = ++read;
        shown = new Set();
        const page = await nextItems(true, mine);
        if (!page) return { sections: [] };
        batches = 1;
        console.info('[Qishui] Explore stream read', { count: page.items.length });
        return { sections: [{ id: 'stream', title: i18n.t('qishui.recommended'), items: page.items,
            ...(page.hasMore ? { moreCursor: stampCursor(mine, 'stream') } : {}) }], refreshReadsAnew: true };
    },
    async getSectionItems(cursor) {
        if (cursorWords(cursor, read) !== 'stream' || batches >= 10) return { items: [] };
        const mine = read;
        const page = await nextItems(false, mine);
        if (!page) return { items: [] };
        batches++;
        return { items: page.items, ...(page.hasMore && batches < 10 ? { moreCursor: stampCursor(mine, 'stream') } : {}) };
    },
};
