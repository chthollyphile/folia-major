import type { OnlineLibraryProvider, ProviderCollection } from '../../../types/onlineMusic';
import { createYtmPager, normalizeYtmCollection } from './ytmNormalize';
import { requestYtm } from './ytmTransport';
import type { YtmOperation, YtmWireCollection, YtmWirePage, YtmWirePlaylistPage, YtmWireSong } from './ytmTransport';

// src/services/onlineMusic/ytm/ytmLibrary.ts

// The account's liked-music list, read to its end for the hearts. A request brings 100 rows
// (2026-10-09), so this many requests read the longest list YouTube keeps (5000 rows); the bound
// is for a list that never ends.
const LIKED_LIST = 'LM';
const LIKED_MAX_REQUESTS = 50;
const LIKED_PAGE_ROWS = 100;

const libraryPager = createYtmPager<ProviderCollection>();
export const clearYtmLibraryCache = (): void => libraryPager.clear();

const libraryPage = (operation: YtmOperation, type: string, limit: number, offset: number) => libraryPager.page(
    operation, offset, limit,
    async continuation => {
        const page = await requestYtm<YtmWirePage<YtmWireCollection>>(operation, { continuation });
        return { items: page.items.map(item => normalizeYtmCollection(item, type)), continuation: page.continuation };
    },
);

export const ytmLibrary: OnlineLibraryProvider = {
    getUserPlaylists: (_userId, limit, offset) => libraryPage('user_playlists', 'playlist', limit, offset),
    // The id of every liked song, which is what shows a song's heart as full.
    async getLikedSongIds() {
        const ids: string[] = [];
        let continuation: string | undefined;
        for (let requests = 1; requests <= LIKED_MAX_REQUESTS; requests += 1) {
            const page = await requestYtm<YtmWirePage<YtmWireSong>>('playlist', { id: LIKED_LIST, continuation });
            ids.push(...page.items.map(song => song.id));
            if (!page.continuation) {
                // A full page that names no next one: the list may end exactly here, or the token
                // sits where it is not looked for (YouTube moved it on 2026-10-07). It is not
                // taken for the end, so no heart goes out on it.
                const whole = page.items.length < LIKED_PAGE_ROWS;
                console.log(`[Ytm] Liked songs: ${ids.length} read in ${requests} request(s)${whole ? '' : '; the last page was full and named no next one, so the list is not taken as whole'}`);
                return { ids, whole };
            }
            // A token that repeats would bring the same page again: the list goes on, unread.
            if (page.continuation === continuation) {
                console.warn(`[Ytm] The liked list gave the same page token twice: ${ids.length} songs were read in ${requests} request(s), the hearts of the others stay as they were`);
                return { ids, whole: false };
            }
            continuation = page.continuation;
        }
        console.warn(`[Ytm] The liked list goes on after ${LIKED_MAX_REQUESTS} requests: ${ids.length} songs were read, the hearts of the others stay as they were`);
        return { ids, whole: false };
    },
    // How many songs the liked list holds, as the header of its first page names it. The page is
    // asked for anew each time, not through libraryPager. null where the header names no count.
    async getLikedSongCount() {
        const page = await requestYtm<YtmWirePlaylistPage>('playlist', { id: LIKED_LIST });
        const count = page.trackCount ?? null;
        console.log(`[Ytm] Liked songs count: ${count === null ? 'the page names none' : count}`);
        return count;
    },
    getUserAlbums: (_userId, limit, offset) => libraryPage('user_albums', 'album', limit, offset),
};
