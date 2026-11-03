import type { LocalSong, SongResult, UnifiedSong } from '../../../types';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import {
    compareLocalFolderSongs,
    type LocalAlbumGroupKey,
    type LocalAlbumGroupResolver,
    type LocalSongFolderSortDirection,
    type LocalSongFolderSortField,
} from '../../../utils/localSongSorting';

// src/library/core/collection/collectionView.ts
// 从已加载的曲目派生出「这次展示什么、能播什么、操作作用在哪些歌上」。与渲染形态无关：
// 网格和列表拿到的是同一份顺序和同一个操作范围。逻辑原样搬自 GridView，包括本地排序只在
// 文件夹 / 全部歌曲里生效、隐藏集合同时按 key 与 key-下标 两种拼法匹配这些细节。

export type LocalTrackSortContext = {
    songsById: ReadonlyMap<string, LocalSong>;
    field: LocalSongFolderSortField;
    direction: LocalSongFolderSortDirection;
};

/**
 * 本地曲目按「专辑实体」分组，而不是文件里的专辑标签：用户重命名或合并实体后，
 * 显示曲目已经带上了实体的 entityId 和 displayName。
 */
export const buildLocalAlbumGroupResolver = (tracks: readonly SongResult[]): LocalAlbumGroupResolver => {
    const groups = new Map<string, LocalAlbumGroupKey>();
    tracks.forEach(track => {
        const localRef = (track as UnifiedSong).localRef;
        if (!localRef) return;
        groups.set(localRef.songId, {
            entityId: track.album?.entityId,
            name: track.album?.name || '',
        });
    });
    return song => groups.get(song.id);
};

/**
 * 展示顺序：先去掉被隐藏的条目，再按本地排序（仅当给了排序上下文且有本地曲库时）。
 * `hiddenKeys` 里既可以是 playback key，也可以是 `${playbackKey}-${下标}`。
 */
export const deriveDisplayTracks = (
    tracks: SongResult[],
    hiddenKeys: ReadonlySet<string>,
    localSort: LocalTrackSortContext | null,
): SongResult[] => {
    const visibleTracks = hiddenKeys.size === 0
        ? tracks
        : tracks.filter((track, index) => (
            !hiddenKeys.has(`${getPlaybackSongKey(track)}-${index}`)
            && !hiddenKeys.has(getPlaybackSongKey(track))
        ));
    if (!localSort || localSort.songsById.size === 0) {
        return visibleTracks;
    }

    const resolveAlbumGroup = buildLocalAlbumGroupResolver(tracks);
    return [...visibleTracks].sort((left, right) => {
        const leftLocalRef = (left as UnifiedSong).localRef;
        const rightLocalRef = (right as UnifiedSong).localRef;
        const leftLocalSong = leftLocalRef ? localSort.songsById.get(leftLocalRef.songId) : undefined;
        const rightLocalSong = rightLocalRef ? localSort.songsById.get(rightLocalRef.songId) : undefined;
        if (!leftLocalSong || !rightLocalSong) return 0;
        return compareLocalFolderSongs(
            leftLocalSong,
            rightLocalSong,
            localSort.field,
            localSort.direction,
            resolveAlbumGroup,
        );
    });
};

/** 可播放的曲目（保持顺序）。可用性判定来自 provider，所以由调用方注入。 */
export const derivePlayableTracks = (
    displayTracks: SongResult[],
    isUnavailable: (track: SongResult) => boolean,
): SongResult[] => displayTracks.filter(track => !isUnavailable(track));

/**
 * 「播放 / 入队当前范围」作用的歌：没有筛选时是全部可播放曲目，有筛选时是命中的可播放曲目。
 * `matchedTracks` 为 null 表示没有筛选。
 */
export const resolveContextTracks = (
    matchedTracks: readonly SongResult[] | null,
    playableTracks: SongResult[],
    isUnavailable: (track: SongResult) => boolean,
): SongResult[] => (
    matchedTracks === null
        ? playableTracks
        : matchedTracks.filter(track => !isUnavailable(track))
);
