import type { LocalSong, SongResult } from '../../../types';
import type { SubsonicAlbum, SubsonicArtist, SubsonicSong } from '../../../types/navidrome';
import type { ProviderCollection, ProviderPage } from '../../../types/onlineMusic';
import type {
    LibraryArtistAlbumSync,
    LibraryArtistLocalLibrary,
    LibraryArtistResource,
    LibraryArtistSnapshot,
    LibraryArtistSource,
    LibraryArtistUpdateHint,
} from './artist.contract';
import type { LibraryCollectionDescriptor } from '../collection/collection.contract';
import {
    appendArtistAlbums,
    ARTIST_ALBUM_OFFSET_CAP,
    ARTIST_ALBUM_PAGE_GAP_MS,
    ARTIST_ALBUM_PAGE_SIZE,
    ARTIST_TOP_SONG_LIMIT,
    deriveLocalArtist,
    localArtistEntityId,
    mapNavidromeArtist,
    mapOnlineArtistDetail,
    toOnlineArtistAlbum,
} from './artistModel';

// src/library/core/artist/artistResource.service.ts
// 歌手资源：原先 ArtistGridView 自己的加载（在线详情 + 热门歌曲 + 专辑分页、Navidrome getArtist + 前几张专辑的歌、
// 本地按 catalog 派生），挪进 core，由宿主按 collectionKey 持有。
//
// - generation 归属：每次加载 / 续页领一张票，每个 await 之后先验票；reload、pause、dispose 都让旧票作废，
//   被取代的加载从不写快照。（原先 Navidrome 分支在 getArtist 回来之后不验 generation，晚到的旧应答会把
//   旧详情写回来。）
// - 专辑分页：每页 50 张、页间隔 60ms、offset 上限 10000；某页失败记为 interrupted(failed) + 失败的 offset，
//   retryAlbums 从那里续，详情与热门歌曲不重新请求。pause 时正在分页记为 interrupted(paused)，复用时 ensure 续上。
// - 本地歌手：由宿主交来的 catalog 快照与歌曲同步派生；catalog 未就绪时保持 loading（原先歌手页自己的
//   catalog 未就绪时直接返回，页面先闪一下空态）。
// - 加载失败（在线详情 / 热门歌曲抛错、Navidrome 拿不到歌手或没有配置）记为 status 'error'（原先只打 console，
//   页面落到空态）。
// 上游调用全部经注入的 deps（默认装配在 artistResourceDeps，单测不经过它）。

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Navidrome 的一个已连接的来源（配置在 deps 里闭包好，资源不碰配置）。 */
export type NavidromeArtistSource = {
    getArtist(artistId: string): Promise<(SubsonicArtist & { album?: SubsonicAlbum[] }) | null>;
    getAlbum(albumId: string): Promise<SubsonicAlbum | null>;
    coverArtUrl(coverArtId: string): string;
    toSong(song: SubsonicSong): SongResult;
};

export type ArtistResourceDeps = {
    getArtistDetail(descriptor: LibraryCollectionDescriptor): Promise<ProviderCollection | null>;
    getArtistSongs(descriptor: LibraryCollectionDescriptor, page: { limit: number; offset: number }): Promise<ProviderPage<SongResult>>;
    getArtistAlbums(descriptor: LibraryCollectionDescriptor, page: { limit: number; offset: number }): Promise<ProviderPage<ProviderCollection>>;
    /** 没有 Navidrome 配置时为 null。 */
    connectNavidrome(): NavidromeArtistSource | null;
    local: {
        resolveCoverUrl(song: LocalSong): string | undefined;
        toTracks(songs: LocalSong[], catalog: LibraryArtistLocalLibrary['catalog']): SongResult[];
        applyCover(track: SongResult, coverUrl: string): SongResult;
    };
    /** 在调用时读当前语言（详情里的「歌手」「本地歌手」与未知专辑名）。 */
    t: Translate;
    /** 专辑页之间的间隔。 */
    wait(ms: number): Promise<void>;
    reportError?(message: string, error: unknown): void;
};

const EMPTY: Omit<LibraryArtistSnapshot, 'key'> = {
    status: 'idle',
    detail: null,
    topSongs: [],
    albums: [],
    albumSync: { state: 'none' },
    error: null,
    hint: 'urgent',
};

const sourceOf = (descriptor: LibraryCollectionDescriptor): LibraryArtistSource => descriptor.source;

/** 为一个歌手（一个 collectionKey）创建资源。只创建对象，不发请求（请求由 ensure 触发）。 */
export const createArtistResource = (
    key: string,
    initialDescriptor: LibraryCollectionDescriptor,
    deps: ArtistResourceDeps,
): LibraryArtistResource => {
    const source = sourceOf(initialDescriptor);
    let descriptor = initialDescriptor;
    let snapshot: LibraryArtistSnapshot = { key, ...EMPTY };
    let generation = 0;
    let paused = false;
    let disposed = false;
    let local: LibraryArtistLocalLibrary | undefined;
    /** 最近一次派生用的本地输入（同一份 catalog 与歌曲不重复派生、不重复通知）。 */
    let derivedFrom: { catalog: unknown; songs: unknown } | null = null;
    const listeners = new Set<() => void>();
    const report = deps.reportError ?? ((message: string, error: unknown) => console.error(message, error));

    const commit = (patch: Partial<Omit<LibraryArtistSnapshot, 'key' | 'hint'>>, hint: LibraryArtistUpdateHint = 'urgent') => {
        snapshot = { ...snapshot, ...patch, hint };
        listeners.forEach(listener => listener());
    };

    /** 领一张新票；之前的票全部作废。 */
    const take = () => ++generation;
    const isCurrent = (ticket: number) => !disposed && ticket === generation;

    // 在线专辑从 startOffset 往后翻页；每页之后验票，失败记下失败的 offset。
    const syncAlbums = async (ticket: number, startOffset: number) => {
        commit({ albumSync: { state: 'syncing', offset: startOffset } });
        for (let offset = startOffset; offset < ARTIST_ALBUM_OFFSET_CAP; offset += ARTIST_ALBUM_PAGE_SIZE) {
            let page: ProviderPage<ProviderCollection>;
            try {
                page = await deps.getArtistAlbums(descriptor, { limit: ARTIST_ALBUM_PAGE_SIZE, offset });
            } catch (error) {
                if (!isCurrent(ticket)) return;
                report('[ArtistResource] Failed to progressively load albums', error);
                commit({ albumSync: { state: 'interrupted', offset, reason: 'failed' } });
                return;
            }
            if (!isCurrent(ticket)) return;
            const items = page?.items || [];
            const nextOffset = offset + ARTIST_ALBUM_PAGE_SIZE;
            const done = !page?.hasMore || items.length === 0 || nextOffset >= ARTIST_ALBUM_OFFSET_CAP;
            const albumSync: LibraryArtistAlbumSync = done ? { state: 'none' } : { state: 'syncing', offset: nextOffset };
            commit({ albums: appendArtistAlbums(snapshot.albums, items.map(toOnlineArtistAlbum)), albumSync }, 'background');
            if (done) return;
            await deps.wait(ARTIST_ALBUM_PAGE_GAP_MS);
            if (!isCurrent(ticket)) return;
        }
    };

    const loadOnline = async (ticket: number) => {
        let detail: ProviderCollection | null;
        let songsPage: ProviderPage<SongResult>;
        try {
            [detail, songsPage] = await Promise.all([
                deps.getArtistDetail(descriptor),
                deps.getArtistSongs(descriptor, { limit: ARTIST_TOP_SONG_LIMIT, offset: 0 }),
            ]);
        } catch (error) {
            if (!isCurrent(ticket)) return;
            report('[ArtistResource] Failed to load artist', error);
            commit({ status: 'error', error: 'load-failed' });
            return;
        }
        if (!isCurrent(ticket)) return;
        commit({
            status: 'ready',
            detail: detail ? mapOnlineArtistDetail(detail) : null,
            topSongs: (songsPage?.items || []).slice(0, ARTIST_TOP_SONG_LIMIT),
        });
        await syncAlbums(ticket, 0);
    };

    const loadNavidrome = async (ticket: number) => {
        const navidrome = deps.connectNavidrome();
        if (!navidrome) {
            commit({ status: 'error', error: 'source-unavailable' });
            return;
        }
        try {
            const artist = await navidrome.getArtist(String(descriptor.id));
            if (!isCurrent(ticket)) return;
            if (!artist) {
                commit({ status: 'error', error: 'load-failed' });
                return;
            }
            const mapped = mapNavidromeArtist(artist, {
                fallbackName: descriptor.name,
                coverArtUrl: navidrome.coverArtUrl,
                t: deps.t,
            });
            const albumDetails = await Promise.all(mapped.topSongAlbumIds.map(albumId => navidrome.getAlbum(albumId)));
            if (!isCurrent(ticket)) return;
            const topSongs = albumDetails
                .flatMap(album => album?.song || [])
                .map(song => navidrome.toSong(song))
                .slice(0, ARTIST_TOP_SONG_LIMIT);
            commit({ status: 'ready', detail: mapped.detail, albums: mapped.albums, topSongs });
        } catch (error) {
            if (!isCurrent(ticket)) return;
            report('[ArtistResource] Failed to load Navidrome artist', error);
            commit({ status: 'error', error: 'load-failed' });
        }
    };

    // 本地歌手：catalog 就绪才派生；未就绪时保持 loading（不是空态）。读不出来的 catalog 不会再来：那时是读失败。
    const deriveLocal = (force = false) => {
        if (!local || !local.catalog.ready) {
            derivedFrom = null;
            if (local?.catalog.failed) {
                if (snapshot.status !== 'error') commit({ status: 'error', error: 'load-failed' });
                return;
            }
            if (snapshot.status !== 'loading') commit({ status: 'loading', error: null });
            return;
        }
        if (!force && derivedFrom && derivedFrom.catalog === local.catalog && derivedFrom.songs === local.songs) return;
        derivedFrom = { catalog: local.catalog, songs: local.songs };
        try {
            const derived = deriveLocalArtist(localArtistEntityId(descriptor), local, { ...deps.local, t: deps.t });
            commit({
                status: 'ready',
                detail: derived?.detail ?? null,
                topSongs: derived?.topSongs ?? [],
                albums: derived?.albums ?? [],
                albumSync: { state: 'none' },
                error: null,
            });
        } catch (error) {
            report('[ArtistResource] Failed to derive local artist', error);
            commit({ status: 'error', error: 'load-failed' });
        }
    };

    // 从头加载：清空已有内容（与原来每次重新加载时一样先回到加载中）。
    const start = () => {
        const ticket = take();
        paused = false;
        commit({ ...EMPTY, status: 'loading' });
        if (source === 'local') {
            deriveLocal(true);
            return;
        }
        void (source === 'online' ? loadOnline(ticket) : loadNavidrome(ticket));
    };

    return {
        key,
        source,
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        ensure: (nextDescriptor, nextLocal) => {
            if (disposed) return;
            descriptor = nextDescriptor;
            if (source === 'local') {
                local = nextLocal;
                paused = false;
                deriveLocal();
                return;
            }
            if (snapshot.status === 'idle') {
                start();
                return;
            }
            if (!paused) return;
            paused = false;
            // 暂停时还在首屏加载：那次加载已经作废，从头来。
            if (snapshot.status === 'loading') {
                start();
                return;
            }
            const sync = snapshot.albumSync;
            if (sync.state === 'interrupted' && sync.reason === 'paused') {
                void syncAlbums(take(), sync.offset);
            }
        },
        retryAlbums: () => {
            const sync = snapshot.albumSync;
            if (disposed || source !== 'online' || sync.state !== 'interrupted' || sync.reason !== 'failed') return;
            void syncAlbums(take(), sync.offset);
        },
        reload: () => {
            if (disposed) return;
            start();
        },
        pause: () => {
            if (disposed || paused) return;
            paused = true;
            take();
            const sync = snapshot.albumSync;
            if (sync.state === 'syncing') {
                commit({ albumSync: { state: 'interrupted', offset: sync.offset, reason: 'paused' } });
            }
        },
        dispose: () => {
            if (disposed) return;
            disposed = true;
            take();
            listeners.clear();
        },
        canReuse: () => {
            if (disposed || snapshot.status !== 'ready') return false;
            const sync = snapshot.albumSync;
            return sync.state !== 'interrupted' || sync.reason === 'paused';
        },
    };
};
