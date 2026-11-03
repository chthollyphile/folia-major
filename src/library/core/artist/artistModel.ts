import type { LocalSong, SongResult } from '../../../types';
import type { SubsonicAlbum, SubsonicArtist } from '../../../types/navidrome';
import type { ProviderCollection } from '../../../types/onlineMusic';
import { followEntityRedirect } from '../../../utils/localLibraryIndex';
import type { LibraryCollectionDescriptor } from '../collection/collection.contract';
import type {
    LibraryArtistAlbum,
    LibraryArtistDetail,
    LibraryArtistLocalLibrary,
} from './artist.contract';
import { appendUniqueByKey } from '../collection/collectionPaging';
import { buildLocalCatalogIndex, resolveLocalCatalogLink } from '../shared/localCatalogLinks';

// src/library/core/artist/artistModel.ts
// 歌手页的纯变换（原先写在 ArtistGridView 的加载函数与 useMemo 里）：在线详情映射、Navidrome 歌手映射、
// 本地歌手的派生（实体重定向、歌、专辑表与封面兜底、热门歌曲）、专辑筛选与打开专辑时交给宿主的链接提示。
// 封面解析、本地歌曲转播放曲目与翻译都由调用方注入（model 不碰 service 与 i18n 实例）。

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** 热门歌曲最多几首（在线请求的 limit、Navidrome / 本地的截断）。 */
export const ARTIST_TOP_SONG_LIMIT = 10;
/** 在线专辑每页几张、页与页之间的间隔、offset 上限（与原 ArtistGridView 相同）。 */
export const ARTIST_ALBUM_PAGE_SIZE = 50;
export const ARTIST_ALBUM_PAGE_GAP_MS = 60;
export const ARTIST_ALBUM_OFFSET_CAP = 10000;
/** Navidrome 歌手的热门歌曲取自前几张专辑的歌。 */
export const NAVIDROME_TOP_SONG_ALBUM_COUNT = 5;
/** 本地歌没有专辑归属时，它们归到这张「未知专辑」下。 */
export const UNKNOWN_LOCAL_ALBUM_KEY = '__unknown-album__';

/**
 * 公网的 http 封面升到 https（混合内容会被拦）；Subsonic（/rest/）与局域网地址保持原样。
 * 判据与原 ArtistGridView 的 toHttps 完全相同（包括它对 '10.' / '172.' 的宽松子串匹配）。
 */
export const toHttpsCoverUrl = (url?: string): string => {
    if (!url) return '';
    if (
        url.startsWith('http:') &&
        !url.includes('/rest/') &&
        !url.includes('localhost') &&
        !url.includes('127.0.0.1') &&
        !url.includes('192.168.') &&
        !url.includes('10.') &&
        !url.includes('172.')
    ) {
        return url.replace('http:', 'https:');
    }
    return url;
};

/** 专辑卡用的封面：只认 coverUrl（不再读旧的 picUrl），并升到 https。 */
export const artistAlbumCoverUrl = (album: { readonly coverUrl?: unknown; readonly [field: string]: unknown } | null | undefined): string | undefined => {
    const coverUrl = album?.coverUrl;
    return typeof coverUrl === 'string' && coverUrl ? toHttpsCoverUrl(coverUrl) : undefined;
};

/** 在线 provider 的歌手详情 → 歌手页详情。 */
export const mapOnlineArtistDetail = (detail: ProviderCollection): LibraryArtistDetail => ({
    id: detail.id,
    name: detail.name,
    coverUrl: detail.coverUrl,
    description: detail.description,
    trackCount: detail.trackCount,
    albumCount: detail.albumCount,
    aliases: detail.aliases,
});

/** 在线专辑分页追加：按 id 去重，保持上游顺序。 */
export const appendArtistAlbums = (
    current: readonly LibraryArtistAlbum[],
    page: readonly LibraryArtistAlbum[],
): LibraryArtistAlbum[] => appendUniqueByKey(current, page, album => String(album.id));

/** 在线专辑（provider 的集合）→ 歌手页专辑：provider 的字段原样保留（打开时作为链接提示）。 */
export const toOnlineArtistAlbum = (album: ProviderCollection): LibraryArtistAlbum => ({ ...album });

export type NavidromeArtistMapping = {
    detail: LibraryArtistDetail;
    albums: LibraryArtistAlbum[];
    /** 热门歌曲从这几张专辑里取（按顺序）。 */
    topSongAlbumIds: string[];
};

/** Navidrome 的 getArtist 结果 → 详情与专辑；封面地址由调用方按 Subsonic 配置生成。 */
export const mapNavidromeArtist = (
    artist: SubsonicArtist & { album?: SubsonicAlbum[] },
    {
        fallbackName,
        coverArtUrl,
        t,
    }: { fallbackName: string; coverArtUrl: (coverArtId: string) => string; t: Translate },
): NavidromeArtistMapping => {
    const albums = artist.album || [];
    return {
        detail: {
            name: artist.name || fallbackName,
            coverUrl: albums[0]?.coverArt ? coverArtUrl(albums[0].coverArt) : undefined,
            description: t('navidrome.artists') || 'Artists',
            trackCount: 0,
            albumCount: albums.length,
        },
        albums: albums.map(album => ({
            id: album.id,
            name: album.name,
            coverUrl: album.coverArt ? coverArtUrl(album.coverArt) : undefined,
            publishedAt: album.year ? new Date(album.year, 0, 1).getTime() : undefined,
            trackCount: typeof album.songCount === 'number' && album.songCount > 0 ? album.songCount : undefined,
        })),
        topSongAlbumIds: albums.slice(0, NAVIDROME_TOP_SONG_ALBUM_COUNT).map(album => album.id),
    };
};

export type LocalArtistDeps = {
    /** 本地歌自己的封面（在线元数据封面或内嵌封面），没有时为空。 */
    resolveCoverUrl: (song: LocalSong) => string | undefined;
    /** 本地歌 → 播放用的曲目（带 catalog 的显示名）。 */
    toTracks: (songs: LocalSong[], catalog: LibraryArtistLocalLibrary['catalog']) => SongResult[];
    /** 给曲目换上展示用的封面。 */
    applyCover: (track: SongResult, coverUrl: string) => SongResult;
    t: Translate;
};

export type LocalArtistDerivation = {
    detail: LibraryArtistDetail;
    topSongs: SongResult[];
    albums: LibraryArtistAlbum[];
};

/**
 * 本地歌手：从 catalog 与本地歌曲派生详情、热门歌曲（前 10 首）与专辑。实体 id 跟随合并重定向；
 * 专辑按歌的归属分组，封面取组里第一首有封面的歌；热门歌曲自己没封面时用所在专辑的封面。
 * 实体不存在（或不是歌手）时为 null。调用方保证 catalog 已就绪。
 */
export const deriveLocalArtist = (
    entityId: string,
    local: LibraryArtistLocalLibrary,
    deps: LocalArtistDeps,
): LocalArtistDerivation | null => {
    const { catalog, songs } = local;
    const index = buildLocalCatalogIndex(catalog);
    const link = resolveLocalCatalogLink(catalog, songs, { kind: 'artist', entityId }, index);
    if (!link) return null;
    const artistName = link.entity.displayName;
    const artistSongs = link.songs;

    const albumKeyOf = (song: LocalSong) => {
        const albumEntityId = index.assignmentsBySongId.get(song.id)?.albumEntityId;
        const activeId = albumEntityId ? followEntityRedirect(albumEntityId, index.entitiesById) : undefined;
        return activeId ? index.entitiesById.get(activeId) : undefined;
    };

    const albumMap = new Map<string, { id: string; name: string; coverUrl?: string; publishedAt?: number; trackCount: number }>();
    artistSongs.forEach(song => {
        const albumEntity = albumKeyOf(song);
        const albumKey = albumEntity?.id || UNKNOWN_LOCAL_ALBUM_KEY;
        const coverUrl = deps.resolveCoverUrl(song);
        const existing = albumMap.get(albumKey);
        if (!existing) {
            albumMap.set(albumKey, {
                id: albumKey,
                name: albumEntity?.displayName || deps.t('localMusic.unknownAlbum'),
                coverUrl: coverUrl || undefined,
                publishedAt: undefined,
                trackCount: 1,
            });
        } else {
            existing.trackCount += 1;
            if (coverUrl && !existing.coverUrl) existing.coverUrl = coverUrl;
        }
    });
    const albums = Array.from(albumMap.values());

    const topLocalSongs = artistSongs.slice(0, ARTIST_TOP_SONG_LIMIT);
    const topSongs = deps.toTracks(topLocalSongs, catalog).map((track, position) => {
        const localSong = topLocalSongs[position];
        const albumKey = albumKeyOf(localSong)?.id || UNKNOWN_LOCAL_ALBUM_KEY;
        const coverUrl = deps.resolveCoverUrl(localSong) || albumMap.get(albumKey)?.coverUrl;
        return coverUrl ? deps.applyCover(track, coverUrl) : track;
    });

    return {
        detail: {
            name: artistName,
            coverUrl: albums[0]?.coverUrl || undefined,
            description: deps.t('artistGrid.localArtist', { artistName }),
            trackCount: artistSongs.length,
            albumCount: albums.length,
        },
        topSongs,
        albums,
    };
};

/** 本地歌手描述里的实体 id（首页分组描述带 entityId，没有时用 id）。 */
export const localArtistEntityId = (descriptor: LibraryCollectionDescriptor): string => (
    String((descriptor.source === 'local' && descriptor.entityId) || descriptor.id)
);

/** 歌手页的筛选只看专辑名（大小写不敏感的包含）；热门歌曲不受影响。 */
export const filterArtistAlbums = <TAlbum extends { name?: unknown }>(albums: readonly TAlbum[], query: string): TAlbum[] => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [...albums];
    return albums.filter(album => String(album.name || '').toLowerCase().includes(needle));
};

/** 打开专辑时交给宿主的链接提示：来源与 provider 取自歌手页（专辑自己带 provider 时优先）。 */
export type ArtistAlbumLink = LibraryArtistAlbum & {
    readonly type: 'album';
    readonly source: LibraryCollectionDescriptor['source'];
    readonly providerId?: string;
};

export const artistAlbumLink = (
    album: LibraryArtistAlbum,
    artist: Pick<LibraryCollectionDescriptor, 'source'> & { providerId?: string },
): ArtistAlbumLink => ({
    ...album,
    id: album.id,
    name: album.name,
    coverUrl: artistAlbumCoverUrl(album),
    type: 'album',
    source: artist.source,
    providerId: album.providerId || artist.providerId,
});
