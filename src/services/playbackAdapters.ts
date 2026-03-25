import { LocalSong, SongResult, UnifiedSong } from '../types';
import { NavidromeSong } from '../types/navidrome';

export const getLocalSongId = (localSong: LocalSong): number => {
    const numericPart = parseInt(localSong.id.replace(/\D/g, ''), 10);
    if (!isNaN(numericPart) && numericPart > 0) {
        return -Math.abs(numericPart);
    }

    let hash = 0;
    for (let i = 0; i < localSong.id.length; i++) {
        const char = localSong.id.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return -Math.abs(Math.abs(hash));
};

export function buildUnifiedLocalSong({
    localSong,
    matchedSong,
    coverUrl,
    preferOnlineMetadata,
}: {
    localSong: LocalSong;
    matchedSong: SongResult | null;
    coverUrl: string | null;
    preferOnlineMetadata: boolean;
}): UnifiedSong {
    const displayTitle = localSong.embeddedTitle || localSong.title || localSong.fileName;
    const displayArtist = preferOnlineMetadata
        ? (localSong.matchedArtists || localSong.embeddedArtist || localSong.artist)
        : (localSong.embeddedArtist || localSong.matchedArtists || localSong.artist);
    const displayAlbum = preferOnlineMetadata
        ? (localSong.matchedAlbumName || localSong.embeddedAlbum || localSong.album)
        : (localSong.embeddedAlbum || localSong.matchedAlbumName || localSong.album);

    const unifiedSong: UnifiedSong = {
        id: getLocalSongId(localSong),
        name: displayTitle,
        artists: displayArtist ? [{ id: 0, name: displayArtist }] : [],
        album: displayAlbum ? { id: 0, name: displayAlbum } : { id: 0, name: '' },
        duration: localSong.duration,
        ar: displayArtist ? [{ id: 0, name: displayArtist }] : [],
        al: displayAlbum ? {
            id: 0,
            name: displayAlbum,
            picUrl: coverUrl || undefined
        } : coverUrl ? {
            id: 0,
            name: '',
            picUrl: coverUrl
        } : undefined,
        dt: localSong.duration,
        isLocal: true,
        localData: localSong
    };

    if (!matchedSong) {
        return unifiedSong;
    }

    if (!localSong.embeddedTitle) {
        unifiedSong.name = matchedSong.name;
    }

    if (preferOnlineMetadata || !localSong.embeddedArtist) {
        if (matchedSong.ar) unifiedSong.ar = matchedSong.ar;
        if (matchedSong.artists) unifiedSong.artists = matchedSong.artists;
    }

    if (preferOnlineMetadata || !localSong.embeddedAlbum) {
        if (matchedSong.al) unifiedSong.al = matchedSong.al;
        if (matchedSong.album) unifiedSong.album = matchedSong.album;
    }

    if (coverUrl) {
        if (unifiedSong.album) unifiedSong.album.picUrl = coverUrl;
        if (unifiedSong.al) unifiedSong.al.picUrl = coverUrl;
    }

    return unifiedSong;
}

export function buildLocalQueue(queue: LocalSong[], currentSong?: UnifiedSong): UnifiedSong[] {
    const convertedQueue = queue.map(song => ({
        id: getLocalSongId(song),
        name: song.title || song.fileName,
        artists: song.artist ? [{ id: 0, name: song.artist }] : [],
        album: song.album ? { id: 0, name: song.album } : { id: 0, name: '' },
        duration: song.duration,
        ar: song.artist ? [{ id: 0, name: song.artist }] : [],
        al: song.album ? { id: 0, name: song.album, picUrl: song.matchedCoverUrl } : undefined,
        dt: song.duration,
        isLocal: true,
        localData: song
    } as UnifiedSong));

    if (!currentSong) {
        return convertedQueue;
    }

    return convertedQueue.map(song => {
        if (song.id === currentSong.id) {
            return currentSong;
        }

        if (song.name === currentSong.name && song.duration === currentSong.duration) {
            return currentSong;
        }

        return song;
    });
}

export function buildUnifiedNavidromeSong(
    navidromeSong: NavidromeSong,
    options?: {
        coverUrl?: string;
        useOnlineMetadata?: boolean;
        matchedArtists?: string;
        matchedAlbumName?: string;
    }
): SongResult {
    return {
        id: navidromeSong.id,
        name: (options?.useOnlineMetadata && options.matchedAlbumName) ? options.matchedAlbumName : navidromeSong.name,
        artists: (options?.useOnlineMetadata && options.matchedArtists)
            ? [{ id: 0, name: options.matchedArtists }]
            : (navidromeSong.artists || navidromeSong.ar || []),
        album: navidromeSong.album || (navidromeSong.al ? {
            id: navidromeSong.al.id,
            name: navidromeSong.al.name,
            picUrl: navidromeSong.al.picUrl
        } : { id: 0, name: '' }),
        duration: navidromeSong.duration || navidromeSong.dt || 0,
        ar: navidromeSong.ar || [],
        al: options?.coverUrl
            ? { ...(navidromeSong.al || { id: 0, name: '' }), picUrl: options.coverUrl }
            : navidromeSong.al,
        dt: navidromeSong.dt,
        isNavidrome: true,
        navidromeData: navidromeSong
    } as any;
}

export function buildNavidromeQueue(queue: NavidromeSong[], currentSong?: SongResult): SongResult[] {
    const convertedQueue = queue.map(song => ({
        id: song.id,
        name: song.name,
        artists: song.artists || song.ar || [],
        album: song.album || (song.al ? { id: song.al.id, name: song.al.name, picUrl: song.al.picUrl } : { id: 0, name: '' }),
        duration: song.duration || song.dt || 0,
        ar: song.ar || [],
        al: song.al,
        dt: song.dt,
        isNavidrome: true,
        navidromeData: song
    } as any));

    if (!currentSong) {
        return convertedQueue;
    }

    return convertedQueue.map(song => song.id === currentSong.id ? currentSong : song);
}
