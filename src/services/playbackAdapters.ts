import { LocalSong, SongResult, UnifiedSong } from '../types';
import { NavidromeSong } from '../types/navidrome';

export const getLocalSongId = (localSong: LocalSong): number => {
    // Generate a reliable 52-bit hash from the string ID to avoid parsing long digits and losing precision or colliding.
    // DJB2 style hash into two parts to create a safe integer
    let h1 = 0x811c9dc5;
    let h2 = 0x811c9dc5;
    
    for (let i = 0; i < localSong.id.length; i++) {
        const char = localSong.id.charCodeAt(i);
        h1 ^= char;
        h1 = Math.imul(h1, 0x01000193);
        h2 ^= char;
        h2 = Math.imul(h2, 0x10a9055);
    }
    
    // Combine into a 53-bit safe positive integer, then make it negative
    const high = (h1 & 0x1FFFFF) * 0x100000000;
    const low = (h2 >>> 0);
    const combined = high + low;
    return combined === 0 ? -1 : -combined;
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
    const useMatchedLyrics =
        localSong.lyricsSource === 'online'
        || (!localSong.lyricsSource && !localSong.hasLocalLyrics && !localSong.hasEmbeddedLyrics);
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
        isPureMusic: useMatchedLyrics ? localSong.matchedIsPureMusic : false,
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
    const convertedQueue = queue.map(song => {
        const useMatchedLyrics =
            song.lyricsSource === 'online'
            || (!song.lyricsSource && !song.hasLocalLyrics && !song.hasEmbeddedLyrics);

        return {
            id: getLocalSongId(song),
            name: song.title || song.fileName,
            artists: song.artist ? [{ id: 0, name: song.artist }] : [],
            album: song.album ? { id: 0, name: song.album } : { id: 0, name: '' },
            duration: song.duration,
            isPureMusic: useMatchedLyrics ? song.matchedIsPureMusic : false,
            ar: song.artist ? [{ id: 0, name: song.artist }] : [],
            al: song.album ? { id: 0, name: song.album, picUrl: song.matchedCoverUrl } : undefined,
            dt: song.duration,
            isLocal: true,
            localData: song
        } as UnifiedSong;
    });

    if (!currentSong) {
        return convertedQueue;
    }

    return convertedQueue.map(song => {
        if (song.id === currentSong.id) {
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
    const displayArtists = (options?.useOnlineMetadata && options.matchedArtists)
        ? [{ id: 0, name: options.matchedArtists }]
        : (navidromeSong.artists || navidromeSong.ar || []);
    const displayAlbum = navidromeSong.album || (navidromeSong.al ? {
        id: navidromeSong.al.id,
        name: navidromeSong.al.name,
        picUrl: navidromeSong.al.picUrl
    } : { id: 0, name: '' });
    const displayAl = options?.coverUrl
        ? { ...(navidromeSong.al || displayAlbum || { id: 0, name: '' }), picUrl: options.coverUrl }
        : (navidromeSong.al || displayAlbum);

    return {
        id: navidromeSong.id,
        name: (options?.useOnlineMetadata && options.matchedAlbumName) ? options.matchedAlbumName : navidromeSong.name,
        artists: displayArtists,
        album: displayAlbum,
        duration: navidromeSong.duration || navidromeSong.dt || 0,
        isPureMusic: navidromeSong.lyricsSource === 'online' ? navidromeSong.matchedIsPureMusic : false,
        ar: navidromeSong.ar || displayArtists,
        al: displayAl,
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
        isPureMusic: song.lyricsSource === 'online' ? song.matchedIsPureMusic : false,
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
