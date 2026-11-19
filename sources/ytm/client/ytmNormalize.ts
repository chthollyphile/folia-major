import type { FoliumSourceCollection, FoliumSourceNamedRef, FoliumSourcePage, FoliumSourceSong, FoliumSourceUser } from '@folia/folium';
import { ytmError } from './ytmTransport';
import type { YtmWireArtist, YtmWireCollection, YtmWirePage, YtmWireSong } from './ytmTransport';

// sources/ytm/client/ytmNormalize.ts
// The desktop side's rows → the public contract's DTOs. The host's shapes are the adapter's matter: a
// collection's `data` is what the built-in provider kept as providerData (`playlistId`, a mix's `mix` and
// `videoId`), a song's `row.id` its row in the playlist it was read from (`setVideoId`).

// Rows read from the signed-in client name their artist and album without ids; an empty id means "not known
// yet" and is filled in by `resolveSongCatalogRefs`. Such a name opens nothing in the catalogue (`ref: false`).
const named = (id: string, name: string): FoliumSourceNamedRef => ({ id, name, ...(id ? {} : { ref: false }) });

const artistsOf = (artists: YtmWireArtist[] | undefined): FoliumSourceNamedRef[] => (artists ?? [])
    .filter(artist => artist?.name)
    .map(artist => named(artist.id || '', artist.name));

export const normalizeYtmSong = (raw: unknown): FoliumSourceSong => {
    const item = (raw ?? {}) as Partial<YtmWireSong>;
    if (!item.id) throw ytmError('invalid-response', 'YouTube Music song has no id');
    const albumId = item.album?.id || '';
    return {
        id: item.id,
        title: item.name || '',
        artists: artistsOf(item.artists),
        album: { ...named(albumId, item.album?.name || ''), coverUrl: item.album?.coverUrl || '' },
        durationMs: Math.max(0, Number(item.durationMs) || 0),
        ...(item.setVideoId ? { row: { id: item.setVideoId } } : {}),
        ...(item.video ? { video: true } : {}),
    };
};

export const normalizeYtmUser = (raw: unknown): FoliumSourceUser => {
    const item = (raw ?? {}) as Partial<FoliumSourceUser>;
    return {
        id: String(item.id ?? ''),
        nickname: String(item.nickname ?? ''),
        avatarUrl: item.avatarUrl || '',
        ...(item.vipType === undefined ? {} : { vipType: Number(item.vipType) || 0 }),
    };
};

export const normalizeYtmCollection = (raw: unknown, type = 'playlist'): FoliumSourceCollection => {
    const item = (raw ?? {}) as Partial<YtmWireCollection>;
    if (!item.id) throw ytmError('invalid-response', 'YouTube Music collection has no id');
    const publishedAt = item.publishedAt ?? (item.year ? Date.UTC(item.year, 0, 1) : undefined);
    const data = {
        ...(item.playlistId ? { playlistId: item.playlistId } : {}),
        ...(item.mix ? { mix: true, ...(item.videoId ? { videoId: item.videoId } : {}) } : {}),
    };
    return {
        id: item.id,
        type: item.type || type,
        name: item.name || '',
        coverUrl: item.coverUrl || '',
        description: item.description || '',
        artists: artistsOf(item.artists),
        ...(item.trackCount === undefined ? {} : { trackCount: item.trackCount }),
        ...(publishedAt === undefined ? {} : { publishedAt }),
        // The liked-music list always belongs to the signed-in account.
        ...(item.isLiked ? { isLiked: true, isOwned: true } : {}),
        ...(!item.isLiked && typeof item.isOwned === 'boolean' ? { isOwned: item.isOwned } : {}),
        ...(Object.keys(data).length > 0 ? { data } : {}),
    };
};

/** Whether a collection is a mix (a card of the explore page), read as a queue; `videoId` its first song. */
export const ytmMixOf = (collection?: FoliumSourceCollection): { videoId?: string } | null => {
    if (collection?.data?.mix !== true) return null;
    const first = collection.data.videoId;
    return typeof first === 'string' ? { videoId: first } : {};
};

export const ytmSlicePage = <T>(items: T[], offset: number, limit: number): FoliumSourcePage<T> => {
    const slice = items.slice(offset, offset + limit);
    const nextOffset = offset + slice.length;
    return { items: slice, total: items.length, nextOffset, hasMore: nextOffset < items.length };
};

// A request brings one page of YouTube's, of as many rows as YouTube puts in it (a playlist's
// songs: 100). Past the first page (kept to one request so a list paints quickly) a call gathers
// this many rows before answering, so a background sync of a list that comes in smaller pages is
// not one round of state updates per page.
const FOLLOW_UP_ROWS = 100;
const WALK_IDLE_MS = 5 * 60 * 1000;
const MAX_WALKS = 24;
// Enough to replay the longest list YouTube keeps (5000 rows); the bound is for a list that never ends.
const MAX_REQUESTS_PER_CALL = 400;

interface Walk<T> { items: T[]; continuation?: string; done: boolean; touchedAt: number; queue: Promise<unknown> }

// Folia pages by offset, YouTube by an opaque token. A walk remembers how far one list has been
// read, so consecutive offsets cost one request each. An offset with no walk behind it (a sync
// resumed after a restart, or after the token went stale) replays the list from its start.
export const createYtmPager = <T>(now: () => number = Date.now) => {
    const walks = new Map<string, Walk<T>>();
    return {
        async page(
            key: string,
            offset: number,
            limit: number,
            fetchPage: (continuation?: string) => Promise<YtmWirePage<T>>,
        ): Promise<FoliumSourcePage<T>> {
            let walk = walks.get(key);
            if (!walk || offset === 0 || (!walk.done && now() - walk.touchedAt > WALK_IDLE_MS)) {
                walk = { items: [], done: false, touchedAt: now(), queue: Promise.resolve() };
                walks.delete(key);
                walks.set(key, walk);
                while (walks.size > MAX_WALKS) walks.delete(walks.keys().next().value as string);
            }
            const current = walk;
            const wanted = offset + (offset === 0 ? 1 : Math.min(limit, FOLLOW_UP_ROWS));
            // Calls for one list take turns: two readers must not fetch the same next page twice.
            const turn = current.queue.catch(() => undefined).then(async () => {
                for (let requests = 0; !current.done && current.items.length < wanted && requests < MAX_REQUESTS_PER_CALL; requests++) {
                    const page = await fetchPage(current.continuation);
                    current.items.push(...page.items);
                    current.done = !page.continuation || page.continuation === current.continuation;
                    current.continuation = page.continuation;
                    current.touchedAt = now();
                }
            });
            current.queue = turn;
            await turn;
            // An empty page would read as "the list ends here" and cut a sync short.
            if (!current.done && current.items.length <= offset) {
                throw ytmError('invalid-response', 'YouTube Music list could not be read this far');
            }
            const items = current.items.slice(offset, offset + limit);
            const nextOffset = offset + items.length;
            return {
                items,
                ...(current.done ? { total: current.items.length } : {}),
                nextOffset,
                hasMore: !current.done || nextOffset < current.items.length,
            };
        },
        clear(): void { walks.clear(); },
    };
};
