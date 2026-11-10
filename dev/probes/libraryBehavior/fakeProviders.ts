import type { UnifiedSong } from '../../../src/types';
import {
    OnlineProviderError,
    type MediaId,
    type OnlineMusicProvider,
    type ProviderCollection,
    type ProviderPage,
} from '../../../src/types/onlineMusic';
import { registerOnlineMusicProvider } from '../../../src/services/onlineMusic/providerRegistry';
import { useOnlineProviderAccountStore } from '../../../src/stores/useOnlineProviderAccountStore';
import {
    HOME_CLOUD,
    HOME_FAVORITE_ALBUM_COUNTS,
    HOME_FM_COUNT,
    HOME_FM_PREFIX,
    HOME_LIKED_PLAYLIST,
    HOME_PLAYLIST_FIXTURES,
    HOME_RECOMMENDED_COUNTS,
    homeFavoriteAlbumId,
    homeFavoriteAlbumName,
    homeRecommendedId,
    homeRecommendedName,
    range,
    hasAlias,
    hasGuestArtist,
    hasSecondAlbum,
    hasTranslatedName,
    isProbeUnavailable,
    ONLINE_FIXTURES,
    onlineSongId,
    onlineSongName,
    PROBE_ALBUM,
    PROBE_ALIAS,
    PROBE_PROVIDER_A,
    PROBE_PROVIDER_B,
    PROBE_SECOND_ALBUM,
    PROBE_TRANSLATED_NAME,
    PROBE_TRACKS_UPDATED_AT,
    ONLINE_ARTISTS,
    artistAlbumId,
    artistAlbumName,
    onlineArtistTarget,
    type OnlineArtistRule,
} from './fixtureRules';
import { recordProbeRequest } from './probeLog';
import { createProbeGate, type ProbeGate } from './probeGates';

// dev/probes/libraryBehavior/fakeProviders.ts
// 两个内存里的假在线 provider（probe-a / probe-b）。走真实的 provider registry 和 omni，
// 只把网络换成可控的数据、延迟和故障注入，探针因此能覆盖「omni → 分页 → 缓存 → 界面」整条链。

export type ProbeFault = {
    op: string;
    target: string;
    offset?: number;
    remaining: number;
};

type CollectionData = {
    providerId: string;
    type: string;
    id: string;
    name: string;
    songs: UnifiedSong[];
    error?: 'not-public';
    isOwned?: boolean;
    description?: string;
    /** 详情里额外的字段（?covers=1 时歌手专辑的封面、年份、流派、时长）。 */
    detail?: Partial<ProviderCollection> & { albumYear?: number; albumGenre?: string; albumDuration?: number };
};

const collections = new Map<string, CollectionData>();
const subscriptions = new Map<string, boolean>();
const faults: ProbeFault[] = [];
/** target → 每次请求的延迟；`first` 只作用于 offset 0。 */
const latencies = new Map<string, { first?: number; rest?: number }>();
let dislikeCounter = 0;
/**
 * target → 按住的后台分页（offset > 0）。按住的是应答而不是请求：页面在请求那一刻就按当时的上游数据
 * 生成，放行时才送达，模拟「请求发出之后上游又变了」的晚到页。
 */
const pagingGates = new Map<string, ProbeGate>();
/**
 * 按住上游变更（删歌、订阅、不喜欢……）的应答：请求照常记账，上游数据在放行时才改、应答才回来，
 * 用来制造「删除请求还没回来」的窗口（重复提交、晚到、请求途中关掉集合）。
 */
const mutationGate = createProbeGate();
const isMutationOp = (op: string) => (
    op.startsWith('updatePlaylistTracks:')
    || op === 'like'
    || op === 'unlike'
    || op === 'dislikeSong'
    || /^(un)?subscribe(Playlist|Album)$/.test(op)
);

export const holdProbeMutations = (): void => mutationGate.hold();
export const releaseProbeMutations = (): void => mutationGate.release();

const targetKey = (providerId: string, type: string, id: MediaId) => `${providerId}:${type}:${String(id)}`;
/** 后台分页的接口：按住分页闸门时只按住它们 offset > 0 的应答。 */
const PAGED_OPS: ReadonlySet<string> = new Set(['playlistTracks', 'artistAlbums']);

const artistRuleOf = (providerId: string, id: MediaId): OnlineArtistRule | undefined => (
    Object.values(ONLINE_ARTISTS).find(rule => rule.providerId === providerId && rule.artistId === String(id))
);

/** 在线 fixture 在请求账里的 target。 */
export const onlineFixtureTarget = (fixtureId: keyof typeof ONLINE_FIXTURES): string => {
    const rule = ONLINE_FIXTURES[fixtureId];
    return targetKey(rule.providerId, rule.type, rule.collectionId);
};

export const holdProbePaging = (target: string): void => {
    const gate = pagingGates.get(target) ?? createProbeGate();
    gate.hold();
    pagingGates.set(target, gate);
};

export const releaseProbePaging = (target: string): void => {
    pagingGates.get(target)?.release();
    pagingGates.delete(target);
};

/** 生成一首在线歌：字段形状与 omni 归一化后的 UnifiedSong 一致，专辑带 catalogRef 以便嵌套导航。 */
export const makeOnlineSong = (
    providerId: string,
    prefix: string,
    index: number,
    album?: { id: string; name: string },
): UnifiedSong => {
    const id = onlineSongId(prefix, index);
    const resolvedAlbum = album ?? (hasSecondAlbum(index) ? PROBE_SECOND_ALBUM : PROBE_ALBUM);
    return {
        id,
        name: onlineSongName(index),
        ...(hasAlias(index) ? { aliases: [PROBE_ALIAS] } : {}),
        ...(hasTranslatedName(index) ? { translatedNames: [PROBE_TRANSLATED_NAME] } : {}),
        artists: [
            { id: 'ar-1', name: 'Probe Artist' },
            ...(hasGuestArtist(index) ? [{ id: 'ar-2', name: 'Guest Singer' }] : []),
        ],
        album: {
            id: resolvedAlbum.id,
            name: resolvedAlbum.name,
            catalogRef: { providerId, kind: 'album', id: resolvedAlbum.id },
            ...(PROBE_COVERS ? { coverUrl: probePosterCover(`${prefix}-${index}`) } : {}),
        },
        durationMs: 180000 + index * 1000,
        ...(PROBE_COVERS ? { coverUrl: probePosterCover(`${prefix}-${index}`) } : {}),
        sourceRef: { kind: 'online', providerId, mediaId: id },
    };
};

/**
 * 手动点检用的封面（?covers=1 时才有）：按 id 生成一张方形的几何海报 SVG（data URI，不发请求）。用例不带这个参数，
 * 请求账与画面断言都不受影响。
 */
const PROBE_COVERS = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('covers');
const PROBE_COVER_PALETTES = [
    ['#22305f', '#e4462b', '#efe9dc'], ['#2f5d50', '#efe9dc', '#141210'], ['#5a1e3c', '#f2b632', '#efe9dc'],
    ['#efe9dc', '#141210', '#e4462b'], ['#f2b632', '#141210', '#22305f'], ['#3b3530', '#7fd1ae', '#efe9dc'],
    ['#7fd1ae', '#141210', '#efe9dc'], ['#e4462b', '#141210', '#efe9dc'],
];
/**
 * 拿真图点检（?realCovers=<目录地址>&realCoverCount=N）：封面换成那个目录里的 a01.jpg … aNN.jpg（按 id 挑一张）。
 * 图放在本机、自己起一个带 CORS 头的静态服务（专辑墙读封面像素要 CORS），不进仓库。
 */
const PROBE_REAL_COVERS = (() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const base = params.get('realCovers');
    const count = Number(params.get('realCoverCount'));
    return base && count > 0 ? { base: base.endsWith('/') ? base : `${base}/`, count } : null;
})();

const probePosterCover = (seed: string): string => {
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index += 1) hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619) >>> 0;
    if (PROBE_REAL_COVERS) return `${PROBE_REAL_COVERS.base}a${String((hash % PROBE_REAL_COVERS.count) + 1).padStart(2, '0')}.jpg`;
    const [ground, figure, accent] = PROBE_COVER_PALETTES[hash % PROBE_COVER_PALETTES.length];
    const shape = (hash >>> 4) % 4;
    const art = [
        `<circle cx="300" cy="210" r="130" fill="${figure}"/><path d="M0 400 L150 300 L280 380 L400 280 L512 360 V512 H0Z" fill="${accent}"/>`,
        `<rect x="96" y="96" width="320" height="320" fill="none" stroke="${figure}" stroke-width="40"/><rect x="200" y="200" width="112" height="112" fill="${accent}"/>`,
        `<path d="M0 512 L256 120 L512 512Z" fill="${figure}"/><circle cx="380" cy="130" r="54" fill="${accent}"/>`,
        `${Array.from({ length: 8 }, (_, row) => `<rect x="0" y="${row * 64}" width="512" height="28" fill="${row % 2 ? figure : accent}"/>`).join('')}`,
    ][shape];
    return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="${ground}"/>${art}</svg>`)}`;
};

/**
 * ?covers=1 时歌手专辑也有曲目与详情（手动点检从歌手页点进专辑看海报）：每三张里有一张是中文名，详情带封面、年份、
 * 流派、总时长与一句简介，十首歌都用专辑封面。用例不带这个参数，歌手专辑仍然是空的。
 */
const PROBE_CJK_ALBUM_NAMES = ['晚风信', '把今天折进口袋', '海边的第七个夏天', '无人知晓的城市'];
const PROBE_GENRES = ['独立民谣', 'Dream Pop', '电子', 'Post-Rock'];
const probeArtistAlbumName = (index: number): string => (
    PROBE_COVERS && index % 3 === 0 ? PROBE_CJK_ALBUM_NAMES[(index / 3) % PROBE_CJK_ALBUM_NAMES.length] : artistAlbumName(index)
);

const ensureProbeArtistAlbum = (providerId: string, id: string) => {
    const target = targetKey(providerId, 'album', id);
    if (!PROBE_COVERS || collections.has(target)) return;
    const rule = Object.values(ONLINE_ARTISTS).find(candidate => candidate.providerId === providerId && id.startsWith(`${candidate.albumPrefix}-`));
    const index = Number(id.slice((rule?.albumPrefix.length ?? 0) + 1));
    if (!rule || !Number.isInteger(index)) return;
    const album = { id, name: probeArtistAlbumName(index) };
    const coverUrl = probePosterCover(id);
    // 单数号的专辑像「收了几首单曲」：下标 1、4、7 的带自己的封面，下标 5、9 的没有封面（专辑墙切成碎片）；双数号的
    // 专辑全是同一张封面（专辑墙拼成整张封面）。
    const mixed = index % 2 === 1;
    const songs = range(10).map(track => {
        const song = makeOnlineSong(providerId, `${id}-t`, track, album);
        const own = mixed && track % 3 === 1 ? probePosterCover(`${id}-single-${track}`) : mixed && track % 4 === 1 ? undefined : coverUrl;
        return { ...song, coverUrl: own, album: { ...song.album!, coverUrl: own } };
    });
    collections.set(target, {
        providerId,
        type: 'album',
        id,
        name: album.name,
        songs,
        description: index % 2 === 0 ? '我把今天的心事折进口袋，留给晚风。' : undefined,
        detail: {
            coverUrl,
            artists: [{ id: rule.artistId, name: rule.name }],
            albumYear: 2014 + (index % 11),
            albumGenre: PROBE_GENRES[index % PROBE_GENRES.length],
            albumDuration: songs.reduce((total, song) => total + (song.durationMs ?? 0), 0),
            publishedAt: Date.UTC(2014 + (index % 11), index % 12, 1),
        },
    });
};

/** 恢复全部在线 fixture、订阅状态与故障注入的初始值。 */
export const resetFakeProviders = (): void => {
    collections.clear();
    subscriptions.clear();
    faults.length = 0;
    latencies.clear();
    pagingGates.forEach(gate => gate.release());
    pagingGates.clear();
    mutationGate.release();
    dislikeCounter = 0;

    Object.values(ONLINE_FIXTURES).forEach(rule => {
        collections.set(targetKey(rule.providerId, rule.type, rule.collectionId), {
            providerId: rule.providerId,
            type: rule.type,
            id: rule.collectionId,
            name: rule.name,
            songs: rule.rawIndexes.map(index => makeOnlineSong(rule.providerId, rule.prefix, index)),
            ...(rule.collectionId === 'private' ? { error: 'not-public' as const } : {}),
            ...(rule.isOwned ? { isOwned: true } : {}),
            ...(rule.description ? { description: rule.description } : {}),
        });
    });
    // 首页档的云盘曲目（集合详情档不会请求它）。
    collections.set(cloudTarget(HOME_CLOUD.providerId), {
        providerId: HOME_CLOUD.providerId,
        type: 'cloud',
        id: HOME_CLOUD.id,
        name: HOME_CLOUD.name,
        songs: range(HOME_CLOUD.count).map(index => makeOnlineSong(HOME_CLOUD.providerId, HOME_CLOUD.prefix, index)),
    });
    collections.set(targetKey(PROBE_PROVIDER_A, 'album', PROBE_ALBUM.id), {
        providerId: PROBE_PROVIDER_A,
        type: 'album',
        id: PROBE_ALBUM.id,
        name: PROBE_ALBUM.name,
        songs: PROBE_ALBUM.rawIndexes.map(index => makeOnlineSong(PROBE_PROVIDER_A, PROBE_ALBUM.prefix, index, PROBE_ALBUM)),
    });

    faults.push(
        { op: 'playlistTracks', target: targetKey(PROBE_PROVIDER_A, 'playlist', 'flaky'), offset: 150, remaining: 1 },
        // 1 次首发 + 3 次退避重试全部失败，才会进入「中断」。
        { op: 'playlistTracks', target: targetKey(PROBE_PROVIDER_A, 'playlist', 'broken'), offset: 150, remaining: 4 },
    );
    latencies.set(targetKey(PROBE_PROVIDER_A, 'playlist', 'slow'), { first: 1200, rest: 300 });
};

export const addProbeFault = (fault: ProbeFault): void => {
    faults.push(fault);
};

/** 撤掉故障注入（给 target 时只撤这个 target 的）。 */
export const clearProbeFaults = (target?: string): void => {
    const kept = faults.filter(fault => target !== undefined && fault.target !== target);
    faults.length = 0;
    faults.push(...kept);
};

export const setProbeLatency = (target: string, latency: { first?: number; rest?: number }): void => {
    latencies.set(target, latency);
};

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// 统一记账、延迟与故障：每个假接口都从这里过。
const run = async <T>(
    providerId: string,
    op: string,
    target: string,
    details: { offset?: number; limit?: number; ids?: string[] },
    produce: () => T,
): Promise<T> => {
    const latency = latencies.get(target);
    const delay = details.offset === 0 || details.offset === undefined
        ? latency?.first ?? latency?.rest
        : latency?.rest;
    if (delay) await wait(delay);

    const fault = faults.find(candidate => (
        candidate.remaining > 0
        && candidate.op === op
        && candidate.target === target
        && (candidate.offset === undefined || candidate.offset === details.offset)
    ));
    if (fault) {
        fault.remaining -= 1;
        recordProbeRequest({ provider: providerId, op, target, ...details, outcome: 'error' });
        throw new OnlineProviderError('network', `probe fault: ${op} ${target}`, providerId);
    }

    const data = collections.get(target);
    if (data?.error === 'not-public') {
        recordProbeRequest({ provider: providerId, op, target, ...details, outcome: 'error' });
        throw new OnlineProviderError('not-public', 'probe: playlist is not public', providerId);
    }

    recordProbeRequest({ provider: providerId, op, target, ...details, outcome: 'ok' });
    if (isMutationOp(op)) await mutationGate.wait();
    const result = produce();
    const pagingGate = pagingGates.get(target);
    if (pagingGate && PAGED_OPS.has(op) && (details.offset ?? 0) > 0) await pagingGate.wait();
    return result;
};

const pageOf = <T>(all: T[], limit: number, offset: number): ProviderPage<T> => {
    const items = all.slice(offset, offset + limit);
    return {
        items,
        total: all.length,
        hasMore: offset + items.length < all.length,
        nextOffset: offset + items.length,
    };
};

const describe = (data: CollectionData | undefined, fallback?: ProviderCollection): ProviderCollection | null => {
    if (!data) return fallback ?? null;
    return {
        ...(fallback ?? {}),
        providerId: data.providerId,
        id: data.id,
        name: data.name,
        type: data.type,
        trackCount: data.songs.length,
        tracksUpdatedAt: PROBE_TRACKS_UPDATED_AT,
        updatedAt: PROBE_TRACKS_UPDATED_AT,
        ...(data.isOwned ? { isOwned: true } : {}),
        ...(data.description ? { description: data.description } : {}),
        ...(data.detail ?? {}),
    };
};

/**
 * 假 provider 的两档：'collection' 是集合详情探针一直用的那一档（没有账户、没有用户曲库）；
 * 'home' 在它之上补齐首页需要的账户与曲库接口（歌单列表、云盘、收藏专辑、私人 FM、推荐歌单），
 * 能力里打开 auth / userLibrary / userAlbums，首页因此把它当成「已登录的 provider」。
 */
export type FakeProviderProfile = 'collection' | 'home';

const cloudTarget = (providerId: string) => targetKey(providerId, 'cloud', HOME_CLOUD.id);

const homeCloudCollection = (providerId: string): ProviderCollection | null => (
    providerId === HOME_CLOUD.providerId
        ? { providerId, id: HOME_CLOUD.id, name: HOME_CLOUD.name, type: 'cloud', trackCount: HOME_CLOUD.count }
        : null
);

const homeFavoriteAlbums = (providerId: string): ProviderCollection[] => (
    range(HOME_FAVORITE_ALBUM_COUNTS[providerId] ?? 0).map(index => ({
        providerId,
        id: homeFavoriteAlbumId(providerId, index),
        name: homeFavoriteAlbumName(providerId, index),
        type: 'album',
        trackCount: 10,
        artists: [{ id: 'ar-1', name: 'Album Artist' }],
    }))
);

const homeRecommended = (providerId: string): ProviderCollection[] => (
    range(HOME_RECOMMENDED_COUNTS[providerId] ?? 0).map(index => ({
        providerId,
        id: homeRecommendedId(providerId, index),
        name: homeRecommendedName(providerId, index),
        type: 'playlist',
        trackCount: 20,
        creator: { id: 'probe-curator', nickname: 'Probe Curator' },
    }))
);

// 首页档额外的接口：每次调用照样经 run() 记账、可注入延迟与故障（target 见各接口）。
const createHomeExtensions = (providerId: string) => ({
    library: {
        getUserPlaylists: (_userId: MediaId, limit: number, offset: number) => run(
            providerId, 'userPlaylists', `${providerId}:userPlaylists`, { offset, limit },
            () => pageOf((HOME_PLAYLIST_FIXTURES[providerId] ?? []).map(fixtureId => (
                providerId === HOME_LIKED_PLAYLIST.providerId && fixtureId === HOME_LIKED_PLAYLIST.fixture
                    ? { ...describeOnlineFixture(fixtureId), isLiked: true }
                    : describeOnlineFixture(fixtureId)
            )), limit, offset),
        ),
        getUserAlbums: (_userId: MediaId, limit: number, offset: number) => run(
            providerId, 'userAlbums', `${providerId}:userAlbums`, { offset, limit },
            () => pageOf(homeFavoriteAlbums(providerId), limit, offset),
        ),
        getCloudCollection: () => run(providerId, 'cloudCollection', `${providerId}:cloud`, {}, () => homeCloudCollection(providerId)),
    },
    getCloudTracks: (limit: number, offset: number) => run(
        providerId, 'cloudTracks', cloudTarget(providerId), { offset, limit },
        () => pageOf(collections.get(cloudTarget(providerId))?.songs ?? [], limit, offset),
    ),
    getPersonalFm: () => run(providerId, 'personalFm', `${providerId}:fm`, {}, () => (
        range(HOME_FM_COUNT).map(index => makeOnlineSong(providerId, HOME_FM_PREFIX, index))
    )),
    getRecommendedCollections: (limit: number) => run(
        providerId, 'recommendedCollections', `${providerId}:recommended`, { limit },
        () => homeRecommended(providerId).slice(0, limit),
    ),
});

const createFakeProvider = (providerId: string, profile: FakeProviderProfile = 'collection'): OnlineMusicProvider => {
    const base = createCollectionProvider(providerId);
    if (profile === 'collection') return base;
    const home = createHomeExtensions(providerId);
    return {
        ...base,
        capabilities: { ...base.capabilities, auth: true, userLibrary: true, userAlbums: true },
        // 应用读账户时先问平台谁登录着（account/accountRead.ts 的 askWho），没有 auth 就当没人登录、不读歌单。
        // 假平台认探针放进账户 store 的那个用户：探针登出（clearAccount）之后它也说没人。
        auth: {
            getLoginStatus: async () => useOnlineProviderAccountStore.getState().accounts[providerId]?.user ?? null,
            logout: async () => undefined,
        },
        library: home.library,
        catalog: { ...base.catalog, getCloudTracks: home.getCloudTracks },
        recommendations: {
            ...base.recommendations,
            getPersonalFm: home.getPersonalFm,
            getRecommendedCollections: home.getRecommendedCollections,
        },
    };
};

// 歌手页的三个接口（omni.getArtistDetail / getArtistSongs / getArtistAlbums 直通到这里）。三种请求的 target
// 都是 `${providerId}:artist:${id}`，延迟与故障按 op（artistDetail / artistSongs / artistAlbums）区分。
const createArtistCatalog = (providerId: string) => ({
    getArtistDetail: (id: MediaId) => {
        const target = targetKey(providerId, 'artist', id);
        return run(providerId, 'artistDetail', target, {}, (): ProviderCollection | null => {
            const rule = artistRuleOf(providerId, id);
            return rule
                ? {
                    providerId,
                    id: rule.artistId,
                    name: rule.name,
                    type: 'artist',
                    coverUrl: rule.coverUrl,
                    description: rule.description,
                    trackCount: rule.topSongIndexes.length,
                    albumCount: rule.albumCount,
                }
                : null;
        });
    },
    getArtistSongs: (id: MediaId, limit: number, offset: number) => {
        const target = targetKey(providerId, 'artist', id);
        return run(providerId, 'artistSongs', target, { offset, limit }, () => {
            const rule = artistRuleOf(providerId, id);
            const songs = rule ? rule.topSongIndexes.map(index => makeOnlineSong(providerId, rule.topSongPrefix, index)) : [];
            return pageOf(songs, limit, offset);
        });
    },
    getArtistAlbums: (id: MediaId, limit: number, offset: number) => {
        const target = targetKey(providerId, 'artist', id);
        return run(providerId, 'artistAlbums', target, { offset, limit }, () => {
            const rule = artistRuleOf(providerId, id);
            const albums: ProviderCollection[] = rule
                ? range(rule.albumCount).map(index => ({
                    providerId,
                    id: artistAlbumId(rule.albumPrefix, index),
                    name: probeArtistAlbumName(index),
                    type: 'album',
                    trackCount: 10,
                    artists: [{ id: rule.artistId, name: rule.name }],
                    ...(PROBE_COVERS ? { coverUrl: probePosterCover(artistAlbumId(rule.albumPrefix, index)) } : {}),
                }))
                : [];
            return pageOf(albums, limit, offset);
        });
    },
});

/** 歌手 fixture 在请求账里的 target（导出给探针 API 用）。 */
export const onlineArtistFixtureTarget = (fixtureId: keyof typeof ONLINE_ARTISTS): string => onlineArtistTarget(ONLINE_ARTISTS[fixtureId]);

const createCollectionProvider = (providerId: string): OnlineMusicProvider => ({
    id: providerId,
    displayName: `Probe ${providerId}`,
    shortName: providerId,
    getAvailability: () => ({ configured: true }),
    capabilities: {
        search: false,
        playback: true,
        lyrics: false,
        auth: false,
        userLibrary: false,
        playlists: true,
        albums: true,
        artists: false,
        recommendations: true,
        mutations: true,
        wordByWordLyrics: false,
        historyRecommendations: true,
        playlistSubscription: true,
        playlistTrackMutations: true,
        likes: true,
    },
    normalizeSong: raw => raw as UnifiedSong,
    playback: {
        getSongDetail: async () => null,
        getAudioSource: async () => null,
        getAvailability: song => {
            const index = Number(String(song.id).split('-').pop());
            return Number.isFinite(index) && isProbeUnavailable(index)
                ? { state: 'unavailable', label: 'N/A' }
                : { state: 'playable' };
        },
    },
    catalog: {
        getPlaylistTracks: (id, limit, offset) => {
            const target = targetKey(providerId, 'playlist', id);
            return run(providerId, 'playlistTracks', target, { offset, limit }, () => (
                pageOf(collections.get(target)?.songs ?? [], limit, offset)
            ));
        },
        getPlaylistDetail: (id, collection) => {
            const target = targetKey(providerId, 'playlist', id);
            return run(providerId, 'playlistDetail', target, {}, () => describe(collections.get(target), collection));
        },
        getAlbumTracks: (id, limit = 1000, offset = 0) => {
            const target = targetKey(providerId, 'album', id);
            ensureProbeArtistAlbum(providerId, String(id));
            return run(providerId, 'albumTracks', target, { offset, limit }, () => (
                pageOf(collections.get(target)?.songs ?? [], limit, offset)
            ));
        },
        getAlbumDetail: (id, collection) => {
            const target = targetKey(providerId, 'album', id);
            ensureProbeArtistAlbum(providerId, String(id));
            return run(providerId, 'albumDetail', target, {}, () => describe(collections.get(target), collection));
        },
        getSubscriptionStatus: (type, id) => {
            const target = targetKey(providerId, type, id);
            return run(providerId, 'subscriptionStatus', target, {}, () => subscriptions.get(target) ?? false);
        },
        ...createArtistCatalog(providerId),
    },
    recommendations: {
        getDailySongs: () => {
            const target = targetKey(providerId, 'daily_recommendations', 'daily_recommendations');
            return run(providerId, 'dailySongs', target, {}, () => [...(collections.get(target)?.songs ?? [])]);
        },
        getHistoryDates: () => run(providerId, 'historyDates', `${providerId}:history`, {}, () => ['2026-09-30']),
        getHistorySongs: () => run(providerId, 'historySongs', `${providerId}:history`, {}, () => (
            [0, 1, 2].map(index => makeOnlineSong(providerId, 'history', index))
        )),
        dislikeSong: id => run(providerId, 'dislikeSong', `${providerId}:daily`, { ids: [String(id)] }, () => {
            const replacement = makeOnlineSong(providerId, 'daily-r', dislikeCounter);
            dislikeCounter += 1;
            return { replacement };
        }),
    },
    mutations: {
        likeSong: async (song, liked) => {
            const id = typeof song === 'object' ? String(song.id) : String(song);
            await run(providerId, liked ? 'like' : 'unlike', `${providerId}:likes`, { ids: [id] }, () => undefined);
        },
        updatePlaylistTracks: async (operation, playlist, tracks) => {
            const playlistId = typeof playlist === 'object' ? playlist.id : playlist;
            const target = targetKey(providerId, 'playlist', playlistId);
            const ids = tracks.map(track => (typeof track === 'object' ? String(track.id) : String(track)));
            await run(providerId, `updatePlaylistTracks:${operation}`, target, { ids }, () => {
                const data = collections.get(target);
                if (data && operation === 'del') {
                    const removing = new Set(ids);
                    data.songs = data.songs.filter(song => !removing.has(String(song.id)));
                }
            });
        },
        subscribePlaylist: async (playlist, subscribed) => {
            const playlistId = typeof playlist === 'object' ? playlist.id : playlist;
            const target = targetKey(providerId, 'playlist', playlistId);
            await run(providerId, subscribed ? 'subscribePlaylist' : 'unsubscribePlaylist', target, {}, () => {
                subscriptions.set(target, subscribed);
            });
        },
        subscribeAlbum: async (id, subscribed) => {
            const target = targetKey(providerId, 'album', id);
            await run(providerId, subscribed ? 'subscribeAlbum' : 'unsubscribeAlbum', target, {}, () => {
                subscriptions.set(target, subscribed);
            });
        },
    },
});

/** 注册两个假 provider。可重复调用：StrictMode 下挂载 effect 会先拆一次再装回来。 */
export const registerFakeProviders = (profile: FakeProviderProfile = 'collection'): void => {
    registerOnlineMusicProvider(createFakeProvider(PROBE_PROVIDER_A, profile));
    registerOnlineMusicProvider(createFakeProvider(PROBE_PROVIDER_B, profile));
};

/** 把 fixture 规则转成首页「歌单列表」里的那条 ProviderCollection。 */
export const describeOnlineFixture = (fixtureId: keyof typeof ONLINE_FIXTURES): ProviderCollection => {
    const rule = ONLINE_FIXTURES[fixtureId];
    const data = collections.get(targetKey(rule.providerId, rule.type, rule.collectionId));
    return {
        providerId: rule.providerId,
        id: rule.collectionId,
        name: rule.name,
        type: rule.type,
        trackCount: data?.songs.length ?? rule.rawIndexes.length,
        // 每日推荐在真实首页上不带更新时间：它的缓存永远不命中，探针保持一致。
        ...(rule.type === 'playlist'
            ? { tracksUpdatedAt: PROBE_TRACKS_UPDATED_AT, updatedAt: PROBE_TRACKS_UPDATED_AT }
            : {}),
        ...(rule.isOwned ? { isOwned: true } : {}),
        creator: { id: 'probe-someone', nickname: 'Probe Curator' },
    };
};
