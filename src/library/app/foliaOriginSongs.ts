import type { SongResult } from '../../types';
import type { FoliaPlaylistOrigin, FoliaSaveCollectionInput } from '../../types/foliaPlaylist';
import type {
    NavidromeGridViewCollectionDescriptor,
    OnlineGridViewCollectionDescriptor,
} from '../core/collection/collection.contract';
import { ONLINE_COLLECTION_BACKGROUND_PAGE_SIZE } from '../core/collection/resource/onlineCollectionSync.service';
import { resolveNavidromeGridViewTracks } from '../core/collection/resource/navidromeCollectionTracks.service';
import { getNavidromeConfig } from '../../services/navidromeService';
import { omni } from '../../services/onlineMusic/omni';

// src/library/app/foliaOriginSongs.ts
// 转存与「从原歌单更新」读原歌单的那一段：把一张平台歌单 / 专辑（在线音源的，或 Navidrome 的）的歌整张读出来。
// 和打开那张歌单的集合页走同一条读取路径：在线的是 omni.getCollectionTracks 一页页读（集合资源补页用的同一个页大小），
// Navidrome 的是 resolveNavidromeGridViewTracks。读的过程报进度、可以取消；读不到就抛错（调用方什么都不写）。

/** 能转存的集合：在线音源的歌单 / 专辑，Navidrome 的歌单 / 专辑。 */
export type FoliaSavableCollection = OnlineGridViewCollectionDescriptor | NavidromeGridViewCollectionDescriptor;

/** Navidrome 在出处里的来源 id（它不是在线音源，没有音源 id）。 */
export const FOLIA_ORIGIN_NAVIDROME = 'navidrome';

export type FoliaOriginReadProgress = { loaded: number; total?: number };

export type FoliaOriginReadOptions = {
    signal?: AbortSignal;
    onProgress?: (progress: FoliaOriginReadProgress) => void;
};

/** 原来源现在读不了的原因；`read-failed` 带着读的时候抛出来的错。 */
export type FoliaOriginUnreadableReason = 'source-missing' | 'source-off' | 'navidrome-unconfigured' | 'read-failed';

export class FoliaOriginUnreadableError extends Error {
    readonly reason: FoliaOriginUnreadableReason;
    readonly cause?: unknown;

    constructor(reason: FoliaOriginUnreadableReason, cause?: unknown) {
        super(`The origin collection cannot be read (${reason})`);
        this.name = 'FoliaOriginUnreadableError';
        this.reason = reason;
        this.cause = cause;
    }
}

const throwIfAborted = (signal: AbortSignal | undefined): void => {
    if (signal?.aborted) throw new DOMException('Reading the origin collection was cancelled', 'AbortError');
};

export const isAbortError = (error: unknown): boolean => (
    error instanceof DOMException && error.name === 'AbortError'
);

/** 附带数据要能存进数据库：存不了（里面有函数之类）的就不带，刷新时光凭 id 去读。 */
const storableCollectionData = (data: unknown): unknown => {
    if (data === undefined || data === null) return undefined;
    try {
        return structuredClone(data);
    } catch {
        return undefined;
    }
};

/** 一张集合在出处里怎么记。 */
export const describeFoliaOrigin = (collection: FoliaSavableCollection): FoliaSaveCollectionInput['origin'] => {
    const collectionType = collection.type === 'album' ? 'album' as const : 'playlist' as const;
    if (collection.source === 'navidrome') {
        return { sourceId: FOLIA_ORIGIN_NAVIDROME, collectionId: collection.id, name: collection.name, collectionType };
    }
    const collectionData = storableCollectionData(collection.providerData);
    return {
        sourceId: collection.providerId,
        collectionId: String(collection.id),
        name: collection.name,
        collectionType,
        ...(collectionData !== undefined ? { collectionData } : {}),
    };
};

/** 出处 → 能拿去读的集合描述（刷新时原歌单的页面不一定开着）。 */
export const collectionOfFoliaOrigin = (origin: FoliaPlaylistOrigin): FoliaSavableCollection => {
    const type = origin.collectionType === 'album' ? 'album' : 'playlist';
    if (origin.sourceId === FOLIA_ORIGIN_NAVIDROME) {
        return { source: 'navidrome', type, id: origin.collectionId, name: origin.name };
    }
    return {
        source: 'online',
        providerId: origin.sourceId,
        type,
        id: origin.collectionId,
        name: origin.name,
        ...(origin.collectionData !== undefined ? { providerData: origin.collectionData as OnlineGridViewCollectionDescriptor['providerData'] } : {}),
    };
};

/** 原来源此刻在不在（不在的话不去读，直接说原因）。 */
export const resolveFoliaOriginSourceState = (sourceId: string): Exclude<FoliaOriginUnreadableReason, 'read-failed'> | null => {
    if (sourceId === FOLIA_ORIGIN_NAVIDROME) return getNavidromeConfig() ? null : 'navidrome-unconfigured';
    if (omni.getProviderNaming(sourceId) === null) return 'source-missing';
    return omni.isSourceSwitchedOn(sourceId) ? null : 'source-off';
};

// 一张歌单不会有这么多页；音源的 hasMore 一直为真时不让它读个没完。
const MAX_PAGES = 200;

const readOnlineCollectionSongs = async (
    collection: OnlineGridViewCollectionDescriptor,
    { signal, onProgress }: FoliaOriginReadOptions,
): Promise<SongResult[]> => {
    const songs: SongResult[] = [];
    let offset = 0;
    for (let page = 0; page < MAX_PAGES; page += 1) {
        throwIfAborted(signal);
        const answer = await omni.getCollectionTracks(collection, { limit: ONLINE_COLLECTION_BACKGROUND_PAGE_SIZE, offset });
        throwIfAborted(signal);
        songs.push(...answer.items);
        onProgress?.({ loaded: songs.length, ...(typeof answer.total === 'number' ? { total: answer.total } : {}) });
        if (!answer.hasMore) return songs;
        // 音源说还有，这一页却没往前走（空页，或 nextOffset 没动）：没读全，不能当成读完了
        // （刷新会把没读到的歌算成「已不在原歌单里」）。
        if (answer.items.length === 0 || answer.nextOffset <= offset) {
            throw new Error('The source stopped answering before the end of the collection');
        }
        offset = answer.nextOffset;
    }
    throw new Error('The collection has more pages than can be read');
};

/**
 * 把一张集合的歌整张读出来，按集合里的顺序。来源不在、读失败都抛 FoliaOriginUnreadableError；取消抛 AbortError。
 * 读回来是空的不算错（调用方按「空歌单」处理）；音源说还有却读不下去的算读失败。
 */
export const readFoliaOriginSongs = async (
    collection: FoliaSavableCollection,
    options: FoliaOriginReadOptions = {},
): Promise<SongResult[]> => {
    const sourceId = collection.source === 'navidrome' ? FOLIA_ORIGIN_NAVIDROME : collection.providerId;
    const gone = resolveFoliaOriginSourceState(sourceId);
    if (gone) throw new FoliaOriginUnreadableError(gone);
    try {
        if (collection.source === 'navidrome') {
            throwIfAborted(options.signal);
            const { tracks, failed } = await resolveNavidromeGridViewTracks(collection);
            throwIfAborted(options.signal);
            if (failed) throw new Error('Navidrome did not answer for this collection');
            options.onProgress?.({ loaded: tracks.length, total: tracks.length });
            return tracks;
        }
        return await readOnlineCollectionSongs(collection, options);
    } catch (error) {
        if (isAbortError(error)) throw error;
        throw new FoliaOriginUnreadableError('read-failed', error);
    }
};
