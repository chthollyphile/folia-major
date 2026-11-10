import type { OmniPage } from '@/types/onlineMusic';
import { foliumOmniError } from '../../folium/omni/service';

// src/mods/runtime/omni/omniPaging.ts
// The pages of `folium.omni` lists (Folium 1.7): opaque cursors the host hands out, and the slicing behind
// them. Sources page differently (one answers a whole album whatever is asked, one caps its pages and
// turns offsets into page numbers, one walks a cursor of its own), so a mod never sees an offset: the host
// hands the source back only the `nextOffset` that source answered, keeps the page length the first page
// set, and gives out at most that many items a page, keeping what the source gave beyond them for the
// next page.

/** Cursors kept, the least recently used dropped first. */
const MAX_CURSORS = 500;
/**
 * Items a cursor keeps of what a source gave beyond a page; past it they are asked for again. Only of a
 * source that says it has more: one that says it has no more keeps all it gave, since asking it again
 * could not be trusted to go on from there (a source that answers its whole list whatever offset it is
 * given would hand out the first items again, and the list would never end).
 */
const MAX_LEFTOVER = 1000;

/**
 * Which list a run of pages belongs to: the method, the source, and the query or the collection's kind
 * and id. Two lists are the same when all three are equal: a later page of an album or an artist may come
 * with another DTO of it (read again by its key, or after its ref ran out) and still belongs to the list.
 */
export interface FoliumOmniList {
    readonly method: string;
    readonly providerId: string;
    readonly subject: string;
}

interface CursorState {
    readonly list: FoliumOmniList;
    /** The offset to hand the source for what comes after `leftover`, as the source answered it. */
    readonly providerOffset: number;
    /** Whether the source said it has more after `providerOffset`. */
    readonly providerHasMore: boolean;
    /** The page length the first page set. */
    readonly limit: number;
    /** What the first page was read from (`FoliumOmniPageRead.basis`). */
    readonly basis: unknown;
    /**
     * What the source gave that was not handed out yet, in its order: `leftover` from `start` on. The
     * cursors of one answer share its array, so paging through a long answer copies nothing.
     */
    readonly leftover: readonly unknown[];
    /** Where in `leftover` this cursor's page begins. */
    readonly start: number;
    /** The whole list's length as the source last said it; null when it did not. */
    readonly total: number | null;
}

const cursors = new Map<string, CursorState>();
let cursorCounter = 0;

const mintCursor = (state: CursorState): string => {
    cursorCounter += 1;
    const cursor = `cursor-${cursorCounter.toString(36)}`;
    cursors.set(cursor, state);
    if (cursors.size > MAX_CURSORS) {
        const oldest = cursors.keys().next().value;
        if (oldest !== undefined) cursors.delete(oldest);
    }
    return cursor;
};

/* The state of a cursor, marked as just used; undefined when it is unknown or was dropped. */
const takeCursor = (cursor: string): CursorState | undefined => {
    const state = cursors.get(cursor);
    if (state) {
        cursors.delete(cursor);
        cursors.set(cursor, state);
    }
    return state;
};

const sameList = (a: FoliumOmniList, b: FoliumOmniList) => (
    a.method === b.method && a.providerId === b.providerId && a.subject === b.subject
);

/** The list a cursor belongs to, without using it; null when it is unknown or was dropped. */
export const peekFoliumOmniCursorList = (cursor: string): FoliumOmniList | null => cursors.get(cursor)?.list ?? null;

/** One page as the host layer projects it. */
export interface FoliumOmniSlice<T> {
    readonly items: T[];
    readonly nextCursor: string | null;
    readonly total: number | null;
}

export interface FoliumOmniPageRead<T, B = undefined> {
    readonly list: FoliumOmniList;
    /**
     * What the list is read from, such as the host collection, with the source's own data on it. Kept with
     * the cursors: later pages are read from the first page's, whichever DTO of the list they come with.
     */
    readonly basis: B;
    /** The cursor of a later page; null for the first. */
    readonly cursor: string | null;
    /** The page length; read only for the first page, later pages keep the first page's. */
    readonly limit: number;
    /** Asks the source for one page (through the request gate): `limit` items from its `offset`, of `basis`. */
    readonly fetch: (page: { limit: number; offset: number }, basis: B) => Promise<OmniPage<T>>;
    /** Which of the source's items the list holds at all (others are dropped before paging). */
    readonly keep?: (item: T) => boolean;
}

/**
 * One page of a list. Rejects `stale-ref` for a cursor that no longer resolves, and with a TypeError for
 * a cursor of another list. What the source still owes from an earlier answer is handed out first; the
 * source is asked only when that is short of a page and the source said it has more, once per page at
 * most: a page it answers empty while saying it has more comes out empty, with a cursor, rather than
 * the host asking again on the mod's behalf.
 */
export const readFoliumOmniPage = async <T, B = undefined>(read: FoliumOmniPageRead<T, B>): Promise<FoliumOmniSlice<T>> => {
    let state: CursorState;
    if (read.cursor === null) {
        state = {
            list: read.list, providerOffset: 0, providerHasMore: true, limit: read.limit, basis: read.basis, leftover: [], start: 0, total: null,
        };
    } else {
        const found = takeCursor(read.cursor);
        if (!found) throw foliumOmniError('stale-ref');
        if (!sameList(found.list, read.list)) throw new TypeError('invalid-arguments: cursor is for another list');
        state = found;
    }
    const { limit } = state;
    let available = state.leftover as T[];
    let { start, providerOffset, providerHasMore, total } = state;

    if (available.length - start < limit && providerHasMore) {
        const answer = await read.fetch({ limit, offset: providerOffset }, state.basis as B);
        const answered = Array.isArray(answer?.items) ? answer.items : [];
        const items = read.keep ? answered.filter(read.keep) : answered;
        // Less than a page is left over here, so this copies little.
        available = [...available.slice(start), ...items];
        start = 0;
        const nextOffset = Number.isFinite(answer?.nextOffset) ? answer.nextOffset : providerOffset + answered.length;
        providerOffset = nextOffset;
        providerHasMore = Boolean(answer?.hasMore);
        if (typeof answer?.total === 'number' && Number.isFinite(answer.total) && answer.total >= 0) total = answer.total;
        // More than a cursor keeps, from a source that says it has more: the rest is asked for again,
        // from the first one dropped. This counts items as offsets do, which holds for the sources that
        // answer more than they are asked for. What a source that says it has no more gave is all kept
        // (MAX_LEFTOVER).
        if (providerHasMore && available.length > limit + MAX_LEFTOVER) {
            const dropped = available.length - (limit + MAX_LEFTOVER);
            available = available.slice(0, limit + MAX_LEFTOVER);
            providerOffset = Math.max(0, nextOffset - dropped);
        }
    }

    const items = available.slice(start, start + limit);
    const next = start + items.length;
    const nextCursor = next < available.length || providerHasMore
        ? mintCursor({ list: state.list, providerOffset, providerHasMore, limit, basis: state.basis, leftover: available, start: next, total })
        : null;
    return { items, nextCursor, total };
};
