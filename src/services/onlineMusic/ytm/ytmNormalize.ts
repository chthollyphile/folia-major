import type { Artist, UnifiedSong } from '../../../types';
import type { ProviderCatalogRef, ProviderCollection, ProviderPage, ProviderUser } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import type { YtmWireArtist, YtmWireCollection, YtmWirePage, YtmWireSong } from './ytmTransport';

// src/services/onlineMusic/ytm/ytmNormalize.ts

// Rows read from the signed-in client name their artist and album without ids; an empty id means
// "not known yet" and is filled in by `resolveSongCatalogRefs`.
const ref = (kind: 'album' | 'artist', id: string): ProviderCatalogRef | undefined => (
    id ? { providerId: 'ytm', kind, id } : undefined
);

const artistsOf = (artists: YtmWireArtist[] | undefined): Artist[] => (artists ?? [])
    .filter(artist => artist?.name)
    .map(artist => ({ id: artist.id || '', name: artist.name, catalogRef: ref('artist', artist.id || '') }));

// The YouTube video id of a song that belongs to this provider.
export const requireYtmSong = (song: { sourceRef?: UnifiedSong['sourceRef'] }): string => {
    const source = song.sourceRef;
    if (source?.kind !== 'online' || source.providerId !== 'ytm') {
        throw new OnlineProviderError('unsupported', 'Song does not belong to YouTube Music', 'ytm');
    }
    return source.mediaId;
};

// Cached canonical songs pass through unchanged.
export const normalizeYtmSong = (raw: unknown): UnifiedSong => {
    const item = (raw ?? {}) as Partial<YtmWireSong> & { sourceRef?: UnifiedSong['sourceRef'] };
    if (item.sourceRef?.kind === 'online' && item.sourceRef.providerId === 'ytm') return item as unknown as UnifiedSong;
    if (!item.id) throw new OnlineProviderError('invalid-response', 'YouTube Music song has no id', 'ytm');
    const albumId = item.album?.id || '';
    return {
        id: item.id,
        name: item.name || '',
        artists: artistsOf(item.artists),
        album: { id: albumId, name: item.album?.name || '', coverUrl: item.album?.coverUrl || '', catalogRef: ref('album', albumId) },
        durationMs: Math.max(0, Number(item.durationMs) || 0),
        sourceRef: { kind: 'online', providerId: 'ytm', mediaId: item.id },
        ...(item.setVideoId ? { collectionRowId: item.setVideoId } : {}),
        ...(item.video ? { isVideo: true } : {}),
    };
};

export const normalizeYtmUser = (raw: unknown): ProviderUser => {
    const item = (raw ?? {}) as Partial<ProviderUser>;
    return {
        id: String(item.id ?? ''),
        nickname: String(item.nickname ?? ''),
        avatarUrl: item.avatarUrl || '',
        ...(item.vipType === undefined ? {} : { vipType: Number(item.vipType) || 0 }),
    };
};

export const normalizeYtmCollection = (raw: unknown, type = 'playlist'): ProviderCollection => {
    const item = (raw ?? {}) as Partial<YtmWireCollection> & { providerId?: string };
    if (item.providerId === 'ytm') return item as unknown as ProviderCollection;
    if (!item.id) throw new OnlineProviderError('invalid-response', 'YouTube Music collection has no id', 'ytm');
    const publishedAt = item.publishedAt ?? (item.year ? Date.UTC(item.year, 0, 1) : undefined);
    const providerData = {
        ...(item.playlistId ? { playlistId: item.playlistId } : {}),
        ...(item.mix ? { mix: true, ...(item.videoId ? { videoId: item.videoId } : {}) } : {}),
    };
    return {
        providerId: 'ytm',
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
        ...(item.isOwned ? { isOwned: true } : {}),
        ...(Object.keys(providerData).length > 0 ? { providerData } : {}),
    };
};

export const ytmSlicePage = <T>(items: T[], offset: number, limit: number): ProviderPage<T> => {
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
        ): Promise<ProviderPage<T>> {
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
                throw new OnlineProviderError('invalid-response', 'YouTube Music list could not be read this far', 'ytm');
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
