import type { SongResult } from '../../../../types';
import type { MediaId, ProviderCollection, ProviderPage } from '../../../../types/onlineMusic';
import type {
    LibraryHomeFeedOwner,
    LibraryHomeFeedResource,
    LibraryHomeFeedSnapshot,
    LibraryHomeRadioFeed,
} from '../homeModel.contract';

// src/library/core/home/online/onlineHomeFeeds.service.ts
// 在线首页的两份数据：收藏专辑（翻完所有页）与电台 feed（私人 FM、每日推荐、推荐歌单）。原先是 Grid3D 里的
// 组件状态，加载 effect 排在「切 provider 清空」的 effect 前面，切 provider 后新 provider 的列表一直不加载；
// 晚到的应答也没有归属检查。这里每份数据是一个资源：归属（provider + 账户）由调用方显式设置，
// 每次读取领一个 generation，换归属 / 重新读取让旧读取作废，晚到的结果直接丢掉。
// 上游调用经注入的 deps（默认装配在 onlineHomeFeedDeps，单测不经过它）。

/** 收藏专辑每页取多少（与原 Grid3D 相同）。 */
export const FAVORITE_ALBUMS_PAGE_SIZE = 50;
/** 电台页签的推荐歌单数（与原 Grid3D 相同）。 */
export const HOME_FEED_RECOMMENDATION_LIMIT = 35;

export type OnlineHomeFeedDeps = {
    getUserAlbums(userId: MediaId, page: { limit: number; offset: number }): Promise<ProviderPage<ProviderCollection>>;
    getHomeFeed(limit: number): Promise<{
        personalFm: SongResult[];
        dailySongs: SongResult[];
        recommendedCollections: ProviderCollection[];
        partial?: true;
    }>;
    songCoverUrl(song: SongResult | undefined, providerId: string): string | undefined;
    supportsDailySongs?(providerId: string): boolean;
};

const sameOwner = (a: LibraryHomeFeedOwner | null, b: LibraryHomeFeedOwner | null) => (
    a === b || (Boolean(a) && Boolean(b) && a!.providerId === b!.providerId && String(a!.userId) === String(b!.userId))
);

// omni 在 provider 切换后会以 AbortError 拒绝旧 provider 的应答；那是预期的作废，不当错误记。
const isAbortError = (error: unknown) => (
    typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
);

/**
 * 通用的首页数据资源。`load` 收到归属与 `isCurrent`（这次读取是否仍有效，分页读取可以据此提前停下）。
 * 失败时保留已有数据、状态记为 error；ensure 只在这个归属下还没成功读过时才读。
 * isComplete 判为不完整的结果照常显示，但不算「读过」，下次 ensure 再读一遍。
 */
export const createHomeFeedResource = <TData>({
    label,
    empty,
    load,
    isComplete,
}: {
    label: string;
    empty: TData;
    load: (owner: LibraryHomeFeedOwner, isCurrent: () => boolean) => Promise<TData>;
    isComplete?: (data: TData) => boolean;
}): LibraryHomeFeedResource<TData> => {
    let snapshot: LibraryHomeFeedSnapshot<TData> = { owner: null, status: 'idle', loaded: false, data: empty };
    let generation = 0;
    const listeners = new Set<() => void>();

    const commit = (next: LibraryHomeFeedSnapshot<TData>) => {
        snapshot = next;
        listeners.forEach(listener => listener());
    };

    const run = async () => {
        const owner = snapshot.owner;
        if (!owner) return;
        const ticket = ++generation;
        const isCurrent = () => ticket === generation;
        commit({ ...snapshot, status: 'loading' });
        try {
            const data = await load(owner, isCurrent);
            if (!isCurrent()) return;
            commit({ owner, status: 'ready', loaded: isComplete ? isComplete(data) : true, data });
        } catch (error) {
            if (!isCurrent()) return;
            if (!isAbortError(error)) console.error(`[LibraryHome] Failed to load ${label}`, error);
            commit({ ...snapshot, status: 'error' });
        }
    };

    return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        setOwner: (owner) => {
            if (sameOwner(owner, snapshot.owner)) return;
            generation += 1;
            commit({ owner: owner ? { ...owner } : null, status: 'idle', loaded: false, data: empty });
        },
        ensure: () => {
            if (!snapshot.owner || snapshot.loaded || snapshot.status === 'loading') return Promise.resolve();
            return run();
        },
        reload: () => run(),
    };
};

/**
 * 按页读完一个账户的收藏专辑（上游顺序）。上游说没有更多、或下一页的 offset 不再前进时停；
 * 读取作废（换了归属）时不再请求后面的页。
 */
export const loadAllFavoriteAlbums = async (
    deps: Pick<OnlineHomeFeedDeps, 'getUserAlbums'>,
    userId: MediaId,
    isCurrent: () => boolean = () => true,
    pageSize = FAVORITE_ALBUMS_PAGE_SIZE,
): Promise<ProviderCollection[]> => {
    const albums: ProviderCollection[] = [];
    let offset = 0;
    let hasMore = true;
    while (hasMore && isCurrent()) {
        const page = await deps.getUserAlbums(userId, { limit: pageSize, offset });
        albums.push(...page.items);
        hasMore = page.hasMore && page.nextOffset > offset;
        offset = page.nextOffset;
    }
    return albums;
};

/** 收藏专辑资源。 */
export const createFavoriteAlbumsFeed = (
    deps: Pick<OnlineHomeFeedDeps, 'getUserAlbums'>,
): LibraryHomeFeedResource<ProviderCollection[]> => createHomeFeedResource<ProviderCollection[]>({
    label: 'favorite albums',
    empty: [],
    load: (owner, isCurrent) => loadAllFavoriteAlbums(deps, owner.userId, isCurrent),
});

/** 电台 feed 资源：私人 FM 与每日推荐只取封面与数量（卡片由 core/home/homeCards 组装）。 */
export const createRadioFeed = (
    deps: Pick<OnlineHomeFeedDeps, 'getHomeFeed' | 'songCoverUrl' | 'supportsDailySongs'>,
): LibraryHomeFeedResource<LibraryHomeRadioFeed | null> => createHomeFeedResource<LibraryHomeRadioFeed | null>({
    label: 'radio feed',
    empty: null,
    load: async (owner) => {
        const { personalFm, dailySongs, recommendedCollections, partial } = await deps.getHomeFeed(HOME_FEED_RECOMMENDATION_LIMIT);
        return {
            ...(partial ? { partial } : {}),
            personalFmCoverUrl: deps.songCoverUrl(personalFm[0], owner.providerId),
            hasPersonalFm: personalFm.length > 0,
            dailyCoverUrl: deps.songCoverUrl(dailySongs[0], owner.providerId) || '',
            dailyCount: dailySongs.length,
            supportsDailySongs: deps.supportsDailySongs?.(owner.providerId) ?? true,
            recommended: recommendedCollections,
        };
    },
    // 有一块没读到时照常显示读到的部分，但下次进电台页再读一遍（以前整份失败，下次进来也会重读）。
    isComplete: feed => !feed?.partial,
});
