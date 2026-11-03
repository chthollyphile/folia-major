import type { LocalLibraryGroup, LocalSong } from '../../../../types';

// src/library/core/collection/cover/localCollectionCover.ts
// 本地集合（文件夹、专辑、歌单）自定义封面的纯规则：用哪个键记、什么时候盖过自动封面、poster.png 去哪个文件夹找。
// 自定义封面只是曲库里这个集合自己的图，不写进歌曲文件，也不随集合里的歌变化；图片的字节在设置那一刻存下来
// （localCollectionCovers.service），这里只认键与 URL。
// 功能的其它部分：存储与运行时 URL 在同目录的 localCollectionCovers.service，取图与缩放（画布、目录句柄）在
// services/localCollectionCoverSources，对话框在 components/local-collection-cover/；接入点是
// core/home/useLibraryHomeLocal（首页卡片）、core/artist/useArtistView（本地歌手页的专辑）与
// library/app/GridViewOverlayHost（集合层）。

/** 封面从哪里来的（只作记录，显示时不区分）。 */
export type LocalCollectionCoverOrigin = 'poster' | 'upload' | 'song';

/** 判定一个本地集合身份需要的字段：首页分组（LocalLibraryGroup）与集合描述都满足。 */
export type LocalCollectionCoverTarget = {
    type: string;
    id: string | number;
    entityId?: string;
    playlistId?: string;
};

const stripPrefix = (value: string, prefix: string) => (value.startsWith(prefix) ? value.slice(prefix.length) : value);

/**
 * 自定义封面的键；不能设的集合（歌手、在线 / Navidrome 的类型）为 null。选的都是重扫、重启后不变的身份：
 * - 文件夹：分组 id `folder-<相对根的路径>` 去掉前缀，就是文件夹路径本身（「全部歌曲」是固定的 `__all-songs__`）；
 *   文件夹名不能改，重新导入同一个文件夹还是同一个路径。不用描述的 name：「全部歌曲」的 name 随界面语言变。
 * - 专辑：曲库实体 id（local_library_entities 里存着，重扫按别名归回同一个实体）；catalog 还没读好时的旧分组
 *   （`album-<标签>`）没有实体 id，退回分组 id。
 * - 歌单：本地歌单 id（创建时生成，改名不变）。
 */
export const localCollectionCoverKey = (target: LocalCollectionCoverTarget | null | undefined): string | null => {
    if (!target) return null;
    const id = String(target.id);
    if (target.type === 'folder') return `folder:${stripPrefix(id, 'folder-')}`;
    if (target.type === 'album') return `album:${target.entityId || id}`;
    if (target.type === 'playlist') return `playlist:${target.playlistId || stripPrefix(id, 'playlist-')}`;
    return null;
};

/** 这个集合能不能设自定义封面。 */
export const supportsLocalCollectionCover = (target: LocalCollectionCoverTarget | null | undefined): boolean => (
    localCollectionCoverKey(target) !== null
);

/** 集合实际显示的封面：设了自定义封面就是它，否则是自动封面（由集合里的歌推出来的那张）。 */
export const resolveLocalCollectionCover = (
    target: LocalCollectionCoverTarget | null | undefined,
    automaticCoverUrl: string | undefined,
    overrides: ReadonlyMap<string, string>,
): string | undefined => {
    const key = localCollectionCoverKey(target);
    return (key ? overrides.get(key) : undefined) ?? automaticCoverUrl;
};

/** 一组带封面的条目按各自的键换上自定义封面；没有一个要换时返回原数组（memo 的下游不白算）。 */
const applyCoverOverrides = <T extends { readonly coverUrl?: unknown }>(
    items: readonly T[],
    keyOf: (item: T) => string | null,
    overrides: ReadonlyMap<string, string>,
): readonly T[] => {
    if (overrides.size === 0) return items;
    let changed = false;
    const next = items.map(item => {
        const key = keyOf(item);
        const override = key ? overrides.get(key) : undefined;
        if (!override || override === item.coverUrl) return item;
        changed = true;
        return { ...item, coverUrl: override };
    });
    return changed ? next : items;
};

/** 首页分组换上自定义封面；没有一个要换时返回原数组。 */
export const applyLocalCollectionCoverOverrides = <T extends LocalLibraryGroup>(
    groups: T[],
    overrides: ReadonlyMap<string, string>,
): T[] => applyCoverOverrides(groups, localCollectionCoverKey, overrides) as T[];

/**
 * 本地歌手页的专辑换上自定义封面：专辑条目的 id 就是曲库里专辑实体的 id（core/artist/artistModel 按跟随重定向后的
 * 实体分组），与首页专辑分组、由它打开的专辑页是同一个键，所以三处显示同一张图。「未知专辑」那一项没有实体，键里
 * 也不会有它的封面。没有一个要换时返回原数组。
 */
export const applyLocalArtistAlbumCoverOverrides = <T extends { readonly id: string | number; readonly coverUrl?: string }>(
    albums: readonly T[],
    overrides: ReadonlyMap<string, string>,
): readonly T[] => applyCoverOverrides(
    albums,
    album => localCollectionCoverKey({ type: 'album', id: album.id, entityId: String(album.id) }),
    overrides,
);

/**
 * poster.png 去哪个文件夹找（曲库里的文件夹路径，含根文件夹名）；没有对应文件夹时为 null。
 * 文件夹就是它自己（「全部歌曲」没有文件夹）；专辑只有在它的歌全都在同一个文件夹里时才算有文件夹；
 * 歌单是用户自己排的一组歌，没有文件夹。
 */
export const resolveLocalCollectionPosterFolder = (
    target: LocalCollectionCoverTarget & { name?: string; isVirtual?: boolean },
    songs: ReadonlyArray<Pick<LocalSong, 'folderName'>>,
): string | null => {
    if (target.type === 'folder') {
        if (target.isVirtual) return null;
        const folder = stripPrefix(String(target.id), 'folder-');
        return folder || target.name || null;
    }
    if (target.type !== 'album' || songs.length === 0) return null;
    const folder = songs[0].folderName;
    if (!folder) return null;
    return songs.every(song => song.folderName === folder) ? folder : null;
};

/** 用歌曲封面时，一首歌拿哪张图：与自动封面同一条偏好（选了在线封面的先在线，否则先本地）。 */
export const resolveLocalSongCoverCandidates = (
    song: Pick<LocalSong, 'useOnlineCover' | 'localCoverAssetId' | 'onlineMetadata'>,
    coverAssetUrl: (assetId: string | undefined, size?: number) => string | null,
    size?: number,
): string[] => {
    const local = coverAssetUrl(song.localCoverAssetId, size) || undefined;
    const online = song.onlineMetadata?.coverUrl || undefined;
    const ordered = song.useOnlineCover ? [online, local] : [local, online];
    return ordered.filter((url): url is string => Boolean(url));
};

/** 「用一首歌的封面」列表里的一项：同一张封面的歌只列一次（专辑里的歌往往共用一张），记着有几首。 */
export type LocalSongCoverPick = {
    /** 代表这张封面的那首歌（列表里第一首用它的歌）。 */
    songId: string;
    title: string;
    /** 列表里显示的那张图（缩略图尺寸）。 */
    coverUrl: string;
    songCount: number;
};

/**
 * 集合里的歌 → 可选的封面，按歌在集合里的顺序；没有封面的歌不列。两首歌首选的是同一张图（同一个本地封面资源
 * ——资源按内容寻址，内容相同就是同一个 id——或同一个在线地址）时合成一项。
 */
export const buildLocalSongCoverPicks = (
    songs: ReadonlyArray<Pick<LocalSong, 'id' | 'title' | 'useOnlineCover' | 'localCoverAssetId' | 'onlineMetadata'>>,
    coverAssetUrl: (assetId: string | undefined, size?: number) => string | null,
    thumbnailSize: number,
): LocalSongCoverPick[] => {
    const picks = new Map<string, LocalSongCoverPick>();
    songs.forEach(song => {
        const [identity] = resolveLocalSongCoverCandidates(song, coverAssetUrl);
        if (!identity) return;
        const existing = picks.get(identity);
        if (existing) {
            existing.songCount += 1;
            return;
        }
        const [thumbnail] = resolveLocalSongCoverCandidates(song, coverAssetUrl, thumbnailSize);
        picks.set(identity, { songId: song.id, title: song.title, coverUrl: thumbnail ?? identity, songCount: 1 });
    });
    return [...picks.values()];
};
