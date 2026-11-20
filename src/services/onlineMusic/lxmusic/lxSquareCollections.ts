// src/services/onlineMusic/lxmusic/lxSquareCollections.ts
// 洛雪没有「我的账号」这件事：它的歌单页不该是空的。
//
// 选中洛雪时，首页「歌单」直接显示四家（网易云 / QQ / 酷狗 / 酷我）的歌单广场，四家交替排开，
// 点进去就是那家真实的歌单曲目 —— 打开用的是 lxmusic 的 catalog.getPlaylistTracks（id 形如 `kg:123`）。
//
// 取一次就落盘缓存，下次进 App 先拿缓存立刻画出来，再在后台刷新；取失败时保留上次的结果。

import type { MediaId, ProviderCollection } from '../../../types/onlineMusic';
import { ensureLxLikedSongsHydrated, getLxLikedSongs, LX_LIKED_PLAYLIST_ID, subscribeLxLikedSongs } from './lxLikedSongs';
import {
    LX_PUBLIC_PLATFORM_KEYS,
    lxApiPlaylistSquare,
    type LxApiCollection,
    type LxPublicPlatform,
    type LxSquareOrder,
} from './lxmusicTransport';

const CACHE_KEY = 'lxmusic_square_collections_v2';
const CACHE_TTL = 30 * 60 * 1000;
/** 每家取多少张：四家 × 15 已经能把一屏铺满，取太多反而拖慢首屏。 */
const PER_PLATFORM = 15;

/**
 * 歌单页顶部的筛选条件：看哪一家、按什么排、按哪个分类。
 * `platform: 'all'` 是四家混排（洛雪桌面版默认那屏），选到某一家才只看它。
 * 分类只有网易云真的认（`cat` 换成别的值会换出一整批不同的歌单，见 lxmusicTransport 里的实测注释）。
 */
export type LxSquareFilter = {
    platform: LxPublicPlatform | 'all';
    order: LxSquareOrder;
    cat: string;
    /** 二级分类标签（来自 lxApiPlaylistTags）。空串＝该平台不筛分类；换平台时必须清空。 */
    tagId: string;
};

const DEFAULT_FILTER: LxSquareFilter = { platform: 'all', order: 'hot', cat: '全部', tagId: '' };

let filter: LxSquareFilter = { ...DEFAULT_FILTER };

/** 单选一家时多取一些：混排是四家交替，一家只露几条；单独看一家要铺满一屏。 */
const SINGLE_PLATFORM_LIMIT = 30;

type Cached = { at: number; items: ProviderCollection[] };

const isDefaultFilter = (value: LxSquareFilter): boolean => (
    value.platform === 'all' && value.order === 'hot' && value.cat === DEFAULT_FILTER.cat && !value.tagId
);

const readCache = (): Cached | null => {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Cached;
        if (!parsed || !Array.isArray(parsed.items)) return null;
        return parsed;
    } catch {
        return null;
    }
};

const writeCache = (items: ProviderCollection[]): void => {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), items }));
    } catch {
        // 存不下只是下次慢一点。
    }
};

const toCollection = (item: LxApiCollection): ProviderCollection => ({
    providerId: 'lxmusic',
    id: `${item.platform}:${item.id}` as MediaId,
    name: item.name,
    type: 'playlist',
    coverUrl: item.coverUrl,
    description: item.description,
    trackCount: item.trackCount,
    playCount: item.playCount,
    creator: item.creatorName ? { id: `${item.platform}-creator` as MediaId, nickname: item.creatorName } : undefined,
    updatedAt: item.updatedAt,
    providerData: { platform: item.platform, nativeId: item.id, kind: 'playlist' },
});

/**
 * 首页歌单页的第一张固定卡：每台机器上的「我的喜欢」——所有点过喜欢的歌（本机，见 lxLikedSongs）。
 * 它不是广场里的歌单，排四家前面当直达入口；点开走 catalog.getPlaylistTracks 的本机分支。
 */
const likedCollection = (): ProviderCollection => {
    const songs = getLxLikedSongs();
    return {
        providerId: 'lxmusic',
        id: LX_LIKED_PLAYLIST_ID as MediaId,
        name: '我的喜欢',
        type: 'playlist',
        isLiked: true,
        coverUrl: songs[0]?.coverUrl,
        trackCount: songs.length,
        providerData: { kind: 'liked' },
    };
};

/** 四家交替排：一屏里能同时看到各家，而不是先看完网易云。 */
const interleave = (lists: ProviderCollection[][]): ProviderCollection[] => {
    const out: ProviderCollection[] = [];
    const max = Math.max(0, ...lists.map((list) => list.length));
    for (let index = 0; index < max; index += 1) {
        for (const list of lists) {
            if (index < list.length) out.push(list[index]);
        }
    }
    return out;
};

let snapshot: ProviderCollection[] = readCache()?.items ?? [];
let loadedAt = readCache()?.at ?? 0;
let loading: Promise<void> | null = null;
/** 当前这次加载对应哪组筛选：筛选变了就不能复用它（否则新条件永远等不到自己的请求）。 */
let loadingFilter: LxSquareFilter | null = null;
const listeners = new Set<() => void>();

const notify = (): void => {
    listeners.forEach((listener) => listener());
};

const load = async (): Promise<void> => {
    const asked = filter;
    const platforms: LxPublicPlatform[] = asked.platform === 'all' ? [...LX_PUBLIC_PLATFORM_KEYS] : [asked.platform];
    const limit = asked.platform === 'all' ? PER_PLATFORM : SINGLE_PLATFORM_LIMIT;
    const results = await Promise.allSettled(
        platforms.map((platform) => lxApiPlaylistSquare(platform, limit, 0, {
            order: asked.order,
            cat: asked.cat,
            tagId: asked.tagId,
        })),
    );
    // 取的过程中用户又换了筛选：这批已经是上一组的答案，丢掉，让新的那次去画。
    if (asked !== filter) return;
    const lists: ProviderCollection[][] = [];
    results.forEach((result) => {
        if (result.status === 'fulfilled') {
            lists.push(result.value.items.map(toCollection));
        } else {
            console.warn('[lxmusic] 歌单广场取失败：', result.reason);
        }
    });
    const merged = asked.platform === 'all' ? interleave(lists) : lists[0] ?? [];
    snapshot = merged;
    loadedAt = Date.now();
    viewDirty = true;
    if (isDefaultFilter(asked)) writeCache(merged);
    notify();
};

/** 需要时加载（缓存过期或在后台刷新）。同一组筛选已经在加载中就复用同一次请求。 */
export const ensureSquareCollections = (force = false): Promise<void> => {
    // 老版本的喜欢只存了 id：顺手补一次元数据，补到之后第一张卡自己会重画。
    ensureLxLikedSongsHydrated();
    if (loading && loadingFilter === filter) return loading;
    if (!force && snapshot.length > 0 && Date.now() - loadedAt < CACHE_TTL) return Promise.resolve();
    const started = filter;
    loadingFilter = started;
    const promise = load()
        .catch((error) => {
            console.warn('[lxmusic] 歌单广场加载失败：', error);
        })
        .finally(() => {
            if (loading === promise) {
                loading = null;
                loadingFilter = null;
            }
        });
    loading = promise;
    return promise;
};

export const getSquareFilter = (): LxSquareFilter => filter;

/** 换筛选条件：立刻清空列表并重新取一次，避免旧结果先画出来再被替换。 */
export const setSquareFilter = (patch: Partial<LxSquareFilter>): void => {
    const next: LxSquareFilter = { ...filter, ...patch };
    // 换平台时分类必须清掉：四家的标签 id 各自一套，留着上一家的 id 只会取到空列表。
    if (patch.platform !== undefined && patch.platform !== filter.platform) next.tagId = '';
    if (
        next.platform === filter.platform
        && next.order === filter.order
        && next.cat === filter.cat
        && next.tagId === filter.tagId
    ) return;
    filter = next;
    snapshot = [];
    loadedAt = 0;
    viewDirty = true;
    notify();
    void ensureSquareCollections(true);
};

/**
 * 首页要拿的是「我的喜欢」+ 广场四家。
 * 这个数组会被 useSyncExternalStore 当成快照比对，所以必须是稳定引用：
 * 每次新建数组会让 React 认为快照永远在变，直接抛 error #185（无限重渲染）。
 * 因此只在来源真的变了（广场刷新、喜欢增删、筛选切换）时重建一次，其余时候返回同一个数组。
 */
let view: ProviderCollection[] = [];
let viewDirty = true;

const rebuildView = (): void => {
    view = [likedCollection(), ...snapshot];
    viewDirty = false;
};

export const getSquareCollections = (): ProviderCollection[] => {
    if (viewDirty) rebuildView();
    return view;
};

// 点过喜欢 / 取消喜欢时，「我的喜欢」卡的封面和曲目数跟着变。
subscribeLxLikedSongs(() => {
    viewDirty = true;
    notify();
});

export const subscribeSquareCollections = (listener: () => void): () => void => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};
