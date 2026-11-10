import type { Album, Artist, SongResult, UnifiedSong } from '../../../types';
import { resolveNavidromePlaybackCarrier } from '../../../utils/appPlaybackGuards';

// src/library/core/shared/trackLinks.ts
// 曲目上的歌手 / 专辑链接（P4.3 从 suites/grid/shared/gridTrackNavigation 挪进 core：网格的卡片与 TUI 的行认同一套规则）。
// Resolves clickable collection identities without confusing display-only metadata IDs with source IDs.
// 在线歌曲能不能解析出目录引用要问 provider（services/onlineMusic/catalogRefs），属于 service，由调用方注入。

type TrackLinkArtist = {
    id?: number | string;
    entityId?: string;
};

type TrackLinkSong = SongResult & Pick<UnifiedSong, 'isNavidrome' | 'navidromeData'>;

export const resolveTrackArtistTargetId = (
    track: TrackLinkSong | undefined,
    artist: TrackLinkArtist,
): number | string | undefined => {
    if (track?.isNavidrome) {
        return resolveNavidromePlaybackCarrier(track)?.navidromeData.artistId;
    }

    return artist.entityId || artist.id;
};

export const resolveTrackAlbumTargetId = (
    track: TrackLinkSong | undefined,
): number | string | undefined => {
    if (track?.isNavidrome) {
        return resolveNavidromePlaybackCarrier(track)?.navidromeData.albumId;
    }

    return track?.album?.entityId || track?.album?.id;
};

/** 在线歌曲能否解析出这个歌手 / 专辑的目录引用（services/onlineMusic/catalogRefs 的 canResolveSongCatalogRef）。 */
export type TrackCatalogResolver = (song: UnifiedSong, kind: 'album' | 'artist', target: Album | Artist) => boolean;

/** 曲目上的一个歌手：targetId 有值时可以打开（交给宿主的 onOpenArtist）。 */
export type TrackArtistLink = { artist: Artist; targetId: number | string | undefined };

/** 曲目上每个歌手能不能打开、打开时用哪个 id（与网格卡片上可点的歌手名同一条规则）。 */
export const resolveTrackArtistLinks = (track: SongResult, canResolve: TrackCatalogResolver): TrackArtistLink[] => (
    (track.artists ?? []).map(artist => {
        const targetId = resolveTrackArtistTargetId(track, artist);
        const openable = targetId !== undefined
            && targetId !== ''
            && (track.sourceRef?.kind !== 'online' || canResolve(track as UnifiedSong, 'artist', artist));
        return { artist, targetId: openable ? targetId : undefined };
    })
);

/** 曲目的专辑能不能打开；能的话给出专辑与打开时用的 id（与网格卡片上可点的专辑名同一条规则）。 */
export const resolveTrackAlbumLink = (
    track: SongResult,
    canResolve: TrackCatalogResolver,
): { album: Album; targetId: number | string } | null => {
    const album = track.album;
    const targetId = resolveTrackAlbumTargetId(track);
    if (!album || targetId === undefined || targetId === '') return null;
    if (track.sourceRef?.kind === 'online' && !canResolve(track as UnifiedSong, 'album', album)) return null;
    return { album, targetId };
};
