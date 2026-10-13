import type { SongResult } from '../../../types';
import type { UnifiedSong } from '../../../types';
import type {
    LibraryHomeDiscoverFeed,
    LibraryHomeDiscoverLoadOptions,
    LibraryHomeDiscoverSection,
    LibraryHomeFeedOwner,
    LibraryHomeFeedSnapshot,
} from '../contracts/homeModel';
import { dedupeDiscoverSongs } from '../model/discoverSections';

// src/library/core/services/onlineHomeDiscoverFeed.ts
// 发现页的数据：四段推荐（猜你喜欢 / 相似 / 雷达 / 新歌）。原先是 Grid3D 里的组件状态与两个 effect，
// 这里做成一个资源：归属（provider + 账户）由调用方设置，每次读取领一个 generation，晚到的结果丢掉。
//
// 与电台 feed 的差别只有两处，都是用户可感知的：
//   - 有 24 小时本地缓存：退出再进来看到的仍是同一批歌（「换一批」才绕开缓存去上游取新批次）；
//   - 空结果绝不写缓存：一次上游 500 风暴不能把缓存污染成空，否则之后每次回来都绕开缓存重拉，
//     列表永远在变、还越拉越卡。

/** 猜你喜欢单次上游硬顶 5 首，但每次调用返回的歌曲不同，所以并行拉几次按播放键去重凑一份够「扫」的列表。 */
export const DISCOVER_FM_CALLS = 4;
export const DISCOVER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type OnlineHomeDiscoverDeps = {
    getPersonalFm(): Promise<UnifiedSong[]>;
    getRecommendationRowSongs(
        section: 'similar' | 'radar' | 'new-songs',
        options?: { seedSongId?: string },
    ): Promise<UnifiedSong[]>;
};

const cacheKeyOf = (providerId: string) => `folia.discoverCache.${providerId}`;

/** 读缓存：过期、损坏、没有歌曲段的都当没有。返回 null 时调用方照常去上游取。 */
const readDiscoverCache = (providerId: string): LibraryHomeDiscoverSection[] | null => {
    if (typeof localStorage === 'undefined') return null;
    try {
        const raw = localStorage.getItem(cacheKeyOf(providerId));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { savedAt: number; sections: LibraryHomeDiscoverSection[] };
        if (typeof parsed?.savedAt !== 'number') return null;
        if (Date.now() - parsed.savedAt > DISCOVER_CACHE_TTL_MS) return null;
        if (!Array.isArray(parsed.sections)) return null;
        return parsed.sections.filter(section => section && Array.isArray(section.songs));
    } catch {
        return null;
    }
};

const writeDiscoverCache = (providerId: string, sections: LibraryHomeDiscoverSection[]): void => {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(cacheKeyOf(providerId), JSON.stringify({ savedAt: Date.now(), sections }));
    } catch {
        // 写不进（隐私模式 / 配额）只是下次多拉一次，不影响功能。
    }
};

const isAbortError = (error: unknown) => (
    typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
);

const dedupeKeyOf = (song: UnifiedSong): string => String(song.sourceRef?.mediaId ?? song.id);

/** 并行几次猜你喜欢，按播放键去重（每次调用的返回不同，但同一首歌的播放键相同）。 */
const collectFmSongs = async (deps: OnlineHomeDiscoverDeps): Promise<UnifiedSong[]> => {
    const batches = await Promise.all(Array.from({ length: DISCOVER_FM_CALLS }, () => (
        deps.getPersonalFm().catch((error: unknown) => {
            console.warn('[LibraryHome] discover fm call failed', error);
            return [] as UnifiedSong[];
        })
    )));
    const seen = new Set<string>();
    const collected: UnifiedSong[] = [];
    for (const batch of batches) {
        for (const song of batch) {
            const key = dedupeKeyOf(song);
            if (seen.has(key)) continue;
            seen.add(key);
            collected.push(song);
        }
    }
    return collected;
};

/**
 * 发现页资源。sections 由调用方装配（buildDiscoverSections 是纯函数，标题在那里翻译好）。
 * 取数失败时保留已有数据、状态记为 error。
 */
export const createDiscoverFeed = (
    deps: OnlineHomeDiscoverDeps,
    buildSections: (input: {
        fmSongs: UnifiedSong[];
        similarSongs: UnifiedSong[];
        radarSongs: UnifiedSong[];
        newSongs: UnifiedSong[];
        hasSeed: boolean;
    }) => LibraryHomeDiscoverSection[],
    /** 封面按资源的归属 provider 解析：卡片不必再回头问当前页签是谁。 */
    songCoverUrl: (song: SongResult | UnifiedSong | undefined, providerId: string) => string | undefined,
): LibraryHomeDiscoverFeed => {
    let snapshot: LibraryHomeFeedSnapshot<LibraryHomeDiscoverSection[]> = { owner: null, status: 'idle', loaded: false, data: [] };
    let generation = 0;
    const listeners = new Set<() => void>();

    const commit = (next: LibraryHomeFeedSnapshot<LibraryHomeDiscoverSection[]>) => {
        snapshot = next;
        listeners.forEach(listener => listener());
    };

    const run = async (options: LibraryHomeDiscoverLoadOptions = {}) => {
        const owner = snapshot.owner;
        if (!owner) return;
        const providerId = owner.providerId;
        // 队列要稳定：有缓存就直接用这一批，绝不后台重拉——用户点进歌再退回来、或者听着听着切回来，
        // 看到的都该是同一批歌。只有「换一批」才去上游取新批次并回写缓存。
        if (!options.force) {
            const cached = readDiscoverCache(providerId);
            if (cached && cached.length > 0) {
                commit({ owner, status: 'ready', loaded: true, data: dedupeDiscoverSongs(cached) });
                return;
            }
            if (snapshot.data.length > 0) return;
        }
        const ticket = ++generation;
        const isCurrent = () => ticket === generation;
        commit({ ...snapshot, status: 'loading' });
        try {
            // 相似歌曲跟着此刻在听的这首走；没有种子就不请求，那一段整段不出。
            // 种子还必须与当前音源同源：A 家歌的数字 id 拿去打 B 家的相似接口只会问到无关的歌。
            const [fmSongs, similarSongs, radarSongs, newSongs] = await Promise.all([
                collectFmSongs(deps),
                options.seedSongId
                    ? deps.getRecommendationRowSongs('similar', { seedSongId: options.seedSongId })
                        .catch((error: unknown) => { console.warn('[LibraryHome] discover similar failed', error); return [] as UnifiedSong[]; })
                    : Promise.resolve([] as UnifiedSong[]),
                deps.getRecommendationRowSongs('radar')
                    .catch((error: unknown) => { console.warn('[LibraryHome] discover radar failed', error); return [] as UnifiedSong[]; }),
                deps.getRecommendationRowSongs('new-songs')
                    .catch((error: unknown) => { console.warn('[LibraryHome] discover new-songs failed', error); return [] as UnifiedSong[]; }),
            ]);
            if (!isCurrent()) return;
            const sections = buildSections({
                fmSongs,
                similarSongs: similarSongs as UnifiedSong[],
                radarSongs: radarSongs as UnifiedSong[],
                newSongs: newSongs as UnifiedSong[],
                hasSeed: Boolean(options.seedSongId),
            });
            // 空结果（上游全挂了）绝不覆盖已有内容、也绝不写缓存——见文件头的说明。
            if (sections.length > 0) {
                const deduped = dedupeDiscoverSongs(sections);
                writeDiscoverCache(providerId, deduped);
                commit({ owner, status: 'ready', loaded: true, data: deduped });
                return;
            }
            if (snapshot.data.length === 0) {
                commit({ owner, status: 'error', loaded: true, data: snapshot.data });
                return;
            }
            commit({ owner, status: 'ready', loaded: true, data: snapshot.data });
        } catch (error) {
            if (!isCurrent()) return;
            if (!isAbortError(error)) console.error('[LibraryHome] Failed to load discover feed', error);
            // 拉取失败：有内容就留着让用户继续听同一批。
            commit({ ...snapshot, status: snapshot.data.length > 0 ? 'ready' : 'error' });
        }
    };

    return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        setOwner: (owner) => {
            const same = snapshot.owner === owner
                || (snapshot.owner && owner
                    && snapshot.owner.providerId === owner.providerId
                    && String(snapshot.owner.userId) === String(owner.userId));
            if (same) return;
            generation += 1;
            commit({ owner: owner ? { ...owner } : null, status: 'idle', loaded: false, data: [] });
        },
        ensure: options => run(options),
        reload: options => run(options),
        swapBatch: options => run({ ...options, force: true }),
        songCoverUrl: song => songCoverUrl(song, snapshot.owner?.providerId ?? ''),
    };
};
