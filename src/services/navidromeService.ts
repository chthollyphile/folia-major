import {
    NavidromeConfig,
    SubsonicResponse,
    SubsonicAlbum,
    SubsonicSong,
    AlbumList2Response,
    AlbumResponse,
    PingResponse,
    LyricsResponse,
    Search3Response,
    NavidromeSong,
} from '../types/navidrome';
import md5 from 'blueimp-md5';

// LocalStorage key for config
const CONFIG_KEY = 'navidrome_config';
const ENABLED_KEY = 'navidrome_enabled';

// Check if Navidrome is enabled
export const isNavidromeEnabled = (): boolean => {
    return localStorage.getItem(ENABLED_KEY) === 'true';
};

// Set Navidrome enabled state
export const setNavidromeEnabled = (enabled: boolean): void => {
    localStorage.setItem(ENABLED_KEY, enabled ? 'true' : 'false');
};

// Get stored configuration
export const getNavidromeConfig = (): NavidromeConfig | null => {
    try {
        const stored = localStorage.getItem(CONFIG_KEY);
        if (stored) {
            return JSON.parse(stored);
        }
    } catch (e) {
        console.error('[Navidrome] Failed to parse config:', e);
    }
    return null;
};

// Save configuration
export const saveNavidromeConfig = (config: NavidromeConfig): void => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
};

// Clear configuration
export const clearNavidromeConfig = (): void => {
    localStorage.removeItem(CONFIG_KEY);
};

// For Subsonic API, we need the plain password to compute token = md5(password + salt)
// We store it as-is (Subsonic API requirement - unfortunately cannot pre-hash)
export const hashPassword = (password: string): string => {
    // Return the password as-is - Subsonic requires plain password for token generation
    return password;
};

// Generate random salt
const generateSalt = (): string => {
    const array = new Uint8Array(8);
    crypto.getRandomValues(array);
    return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

// Build authentication parameters
const buildAuthParams = (config: NavidromeConfig): URLSearchParams => {
    const salt = generateSalt();
    // Subsonic API: token = md5(password + salt) where password is the plain text password
    // config.passwordHash actually contains the plain password (see hashPassword function)
    const token = md5(config.passwordHash + salt);

    const params = new URLSearchParams();
    params.set('u', config.username);
    params.set('t', token);
    params.set('s', salt);
    params.set('v', '1.16.1'); // Subsonic API version
    params.set('c', 'Folia'); // Client identifier
    params.set('f', 'json'); // Response format

    return params;
};

// Generic API fetch function
const fetchSubsonic = async <T>(
    config: NavidromeConfig,
    endpoint: string,
    extraParams?: Record<string, string>
): Promise<SubsonicResponse<T>> => {
    const url = new URL(`${config.serverUrl}/rest/${endpoint}`);
    const authParams = buildAuthParams(config);

    // Add auth params
    authParams.forEach((value, key) => {
        url.searchParams.set(key, value);
    });

    // Add extra params
    if (extraParams) {
        Object.entries(extraParams).forEach(([key, value]) => {
            url.searchParams.set(key, value);
        });
    }

    const response = await fetch(url.toString());
    if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
    }

    return response.json();
};

// API Methods
export const navidromeApi = {
    // Test connection
    ping: async (config: NavidromeConfig): Promise<boolean> => {
        try {
            const res = await fetchSubsonic<PingResponse>(config, 'ping');
            return res['subsonic-response'].status === 'ok';
        } catch (e) {
            console.error('[Navidrome] Ping failed:', e);
            return false;
        }
    },

    // Get album list
    getAlbumList2: async (
        config: NavidromeConfig,
        type: 'alphabeticalByName' | 'alphabeticalByArtist' | 'newest' | 'recent' | 'frequent' | 'random' = 'alphabeticalByName',
        size: number = 50,
        offset: number = 0
    ): Promise<SubsonicAlbum[]> => {
        try {
            const res = await fetchSubsonic<AlbumList2Response>(config, 'getAlbumList2', {
                type,
                size: size.toString(),
                offset: offset.toString(),
            });
            if (res['subsonic-response'].status === 'ok') {
                return res['subsonic-response'].albumList2?.album || [];
            }
        } catch (e) {
            console.error('[Navidrome] getAlbumList2 failed:', e);
        }
        return [];
    },

    // Get album details with songs
    getAlbum: async (config: NavidromeConfig, id: string): Promise<SubsonicAlbum | null> => {
        try {
            const res = await fetchSubsonic<AlbumResponse>(config, 'getAlbum', { id });
            if (res['subsonic-response'].status === 'ok') {
                return res['subsonic-response'].album;
            }
        } catch (e) {
            console.error('[Navidrome] getAlbum failed:', e);
        }
        return null;
    },

    // Get streaming URL
    getStreamUrl: (config: NavidromeConfig, songId: string, format?: string): string => {
        const url = new URL(`${config.serverUrl}/rest/stream`);
        const authParams = buildAuthParams(config);

        authParams.forEach((value, key) => {
            url.searchParams.set(key, value);
        });

        url.searchParams.set('id', songId);
        if (format) {
            url.searchParams.set('format', format);
        }

        return url.toString();
    },

    // Get cover art URL
    getCoverArtUrl: (config: NavidromeConfig, coverArtId: string, size?: number): string => {
        const url = new URL(`${config.serverUrl}/rest/getCoverArt`);
        const authParams = buildAuthParams(config);

        authParams.forEach((value, key) => {
            url.searchParams.set(key, value);
        });

        url.searchParams.set('id', coverArtId);
        if (size) {
            url.searchParams.set('size', size.toString());
        }

        return url.toString();
    },

    // Get lyrics (from Navidrome)
    getLyrics: async (
        config: NavidromeConfig,
        artist: string,
        title: string
    ): Promise<string | null> => {
        try {
            const res = await fetchSubsonic<LyricsResponse>(config, 'getLyrics', {
                artist,
                title,
            });
            if (res['subsonic-response'].status === 'ok' && res['subsonic-response'].lyrics?.value) {
                return res['subsonic-response'].lyrics.value;
            }
        } catch (e) {
            console.error('[Navidrome] getLyrics failed:', e);
        }
        return null;
    },

    // Search
    search: async (
        config: NavidromeConfig,
        query: string,
        artistCount: number = 5,
        albumCount: number = 10,
        songCount: number = 20
    ): Promise<Search3Response['searchResult3']> => {
        try {
            const res = await fetchSubsonic<Search3Response>(config, 'search3', {
                query,
                artistCount: artistCount.toString(),
                albumCount: albumCount.toString(),
                songCount: songCount.toString(),
            });
            if (res['subsonic-response'].status === 'ok') {
                return res['subsonic-response'].searchResult3 || {};
            }
        } catch (e) {
            console.error('[Navidrome] search failed:', e);
        }
        return {};
    },

    // Convert SubsonicSong to NavidromeSong (for playback)
    toNavidromeSong: (
        config: NavidromeConfig,
        song: SubsonicSong,
        album?: SubsonicAlbum
    ): NavidromeSong => {
        const coverArtId = song.coverArt || album?.coverArt;
        const coverArtUrl = coverArtId
            ? navidromeApi.getCoverArtUrl(config, coverArtId, 600)
            : undefined;

        return {
            // Use negative ID to avoid conflicts with Netease IDs
            id: -Math.abs(parseInt(song.id.replace(/\D/g, ''), 10) || Date.now()),
            name: song.title,
            artists: [{ id: 0, name: song.artist }],
            album: {
                id: 0,
                name: song.album,
                picUrl: coverArtUrl,
            },
            duration: song.duration * 1000, // Convert to milliseconds
            isNavidrome: true,
            navidromeData: {
                id: song.id,
                streamUrl: navidromeApi.getStreamUrl(config, song.id),
                coverArtUrl,
                albumId: song.albumId,
                artistId: song.artistId,
                path: song.path,
                bitRate: song.bitRate,
                suffix: song.suffix,
            },
        };
    },
};
