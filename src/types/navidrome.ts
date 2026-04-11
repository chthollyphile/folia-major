import { LyricData, SongResult } from '../types';

// Navidrome/Subsonic API Configuration
export interface NavidromeConfig {
    serverUrl: string;
    username: string;
    // Stored as MD5 hash for token-based auth
    passwordHash: string;
    // Salt used for the last successful auth
    salt?: string;
}

// Subsonic API Response Wrapper
export interface SubsonicResponse<T> {
    'subsonic-response': {
        status: 'ok' | 'failed';
        version: string;
        type: string;
        serverVersion: string;
        openSubsonic: boolean;
        error?: {
            code: number;
            message: string;
        };
    } & T;
}

// Artist
export interface SubsonicArtist {
    id: string;
    name: string;
    coverArt?: string;
    albumCount?: number;
    artistImageUrl?: string;
}

// Album
export interface SubsonicAlbum {
    id: string;
    name: string;
    artist: string;
    artistId: string;
    coverArt?: string;
    songCount: number;
    duration: number;
    playCount?: number;
    created: string;
    starred?: string;
    year?: number;
    genre?: string;
    song?: SubsonicSong[];
}

// Song/Child
export interface SubsonicSong {
    id: string;
    parent?: string;
    isDir: boolean;
    title: string;
    album: string;
    artist: string;
    track?: number;
    year?: number;
    genre?: string;
    coverArt?: string;
    size: number;
    contentType: string;
    suffix: string;
    duration: number; // seconds
    bitRate?: number;
    path: string;
    playCount?: number;
    discNumber?: number;
    created: string;
    albumId: string;
    artistId: string;
    type: 'music' | 'podcast' | 'audiobook';
    isVideo: boolean;
}

// Album List Response
export interface AlbumList2Response {
    albumList2: {
        album: SubsonicAlbum[];
    };
}

// Album Response
export interface AlbumResponse {
    album: SubsonicAlbum;
}

export interface SubsonicPlaylist {
    id: string;
    name: string;
    comment?: string;
    owner?: string;
    public?: boolean;
    songCount: number;
    duration: number;
    created?: string;
    changed?: string;
    coverArt?: string;
    entry?: SubsonicSong[];
}

export interface PlaylistsResponse {
    playlists?: {
        playlist?: SubsonicPlaylist[];
    };
}

export interface PlaylistResponse {
    playlist: SubsonicPlaylist;
}

export interface ArtistsIndexResponse {
    artists?: {
        ignoredArticles?: string;
        index?: Array<{
            name: string;
            artist: SubsonicArtist[];
        }>;
    };
}

export interface ArtistResponse {
    artist: SubsonicArtist & {
        album?: SubsonicAlbum[];
    };
}

export interface RandomSongsResponse {
    randomSongs?: {
        song?: SubsonicSong[];
    };
}

export interface Starred2Response {
    starred2?: {
        song?: SubsonicSong[];
        album?: SubsonicAlbum[];
        artist?: SubsonicArtist[];
    };
}

// Ping Response
export interface PingResponse {
    // Empty, just checks status
}

// Lyrics Response
export interface LyricsResponse {
    lyrics?: {
        artist?: string;
        title?: string;
        value?: string; // Plain text lyrics (not LRC format usually)
    };
}

// Search3 Response
export interface Search3Response {
    searchResult3: {
        artist?: SubsonicArtist[];
        album?: SubsonicAlbum[];
        song?: SubsonicSong[];
    };
}

export interface StructuredLyricLine {
    start: number;
    value: string;
}

export interface StructuredLyric {
    displayArtist: string;
    displayTitle: string;
    lang: string;
    line: StructuredLyricLine[];
    synced: boolean;
}

export type NavidromeViewSelection =
    | { type: 'album'; albumId: string; }
    | { type: 'artist'; artistId: string; };

export interface LyricsBySongIdResponse {
    lyricsList?: {
        structuredLyrics?: StructuredLyric[];
    };
}

// Extended SongResult for Navidrome songs
export interface NavidromeSong extends SongResult {
    isNavidrome: true;
    navidromeData: {
        id: string;
        streamUrl: string;
        coverArtUrl?: string;
        albumId: string;
        artistId: string;
        path: string;
        bitRate?: number;
        suffix: string;
    };
    // For lyrics matching (similar to local songs)
    matchedSongId?: number;
    matchedLyrics?: LyricData;
    matchedIsPureMusic?: boolean;
    hasManualLyricSelection?: boolean;
    lyricsSource?: 'navi' | 'online';
    useOnlineCover?: boolean;
    useOnlineMetadata?: boolean;
    noAutoMatch?: boolean;
    cachedStructuredLyrics?: StructuredLyricLine[];
    cachedPlainLyrics?: string;
}

// Type guard for NavidromeSong
export function isNavidromeSong(song: SongResult): song is NavidromeSong {
    return 'isNavidrome' in song && (song as NavidromeSong).isNavidrome === true;
}
