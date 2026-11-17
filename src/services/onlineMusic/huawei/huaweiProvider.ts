import type { SongResult, UnifiedSong } from '../../../types';
import {
    OnlineProviderError,
    type LoginFailureDetail,
    type ProviderCollection,
    type LoginState,
    type LoginTexts,
    type MediaId,
    type OnlineMusicProvider,
    type ProviderAudioSource,
    type ProviderLyricsResult,
    type ProviderUser,
} from '../../../types/onlineMusic';
import { createProviderSongMetadata } from '../../../utils/songMetadata';
import { parseLyricsByFormat } from '../../../utils/lyrics/parserCore';
import { isPureMusicLyricText } from '../../../utils/lyrics/pureMusic';
import { hasRenderableLyrics } from '../../../utils/lyrics/validity';
import { huaweiCatalog, huaweiPlaylistCollection, listHuaweiPlaylists } from './huaweiCatalog';
import { describeHuaweiFailure } from './huaweiFailure';
import {
    huaweiLyricUrl,
    huaweiPage,
    normalizeHuaweiCollection,
    normalizeHuaweiSong,
    normalizeHuaweiUser,
} from './huaweiNormalize';
import { getHuaweiTransportAvailability, requestHuawei } from './huaweiTransport';

// src/services/onlineMusic/huawei/huaweiProvider.ts
//
// Huawei Music's catalogue, played from Folia's own player. The account lives in the main process
// (electron/huawei/huaweiApiBridge.cjs): the renderer only names an operation. Search and album and
// artist pages read without an account; playback and per-song lyrics need one, and most songs also
// need the account's Huawei Music subscription. The app returns the platform's own audio URL and
// never decrypts or downloads it.

interface HuaweiSearchAnswer {
    items: unknown[];
    total?: number;
    hasMore?: boolean;
    nextOffset?: number;
}

interface HuaweiAudioAnswer {
    url: string;
    quality: string;
    preview?: boolean;
    fetchedAt?: number;
}

interface HuaweiLyricAnswer {
    lrc?: string;
    hmrc?: string;
}

interface HuaweiRecommendationAnswer {
    items: Array<{
        id: string;
        name: string;
        kind: 'owned' | 'collected';
        daily?: boolean;
        coverUrl?: string;
        trackCount?: number;
        playCount?: number;
        description?: string;
    }>;
    dailyId?: string;
}

interface HuaweiSimilarAnswer {
    items: unknown[];
}

interface HuaweiPlaylistTracksAnswer {
    items: unknown[];
}

interface HuaweiAlbumAnswer {
    items: Array<{
        id: string;
        name: string;
        coverUrl?: string;
        trackCount?: number;
        artistName?: string;
        description?: string;
    }>;
    hasMore?: boolean;
    nextOffset?: number;
}

const LOGIN_TTL_MS = 10 * 60 * 1000;

// Songs already seen in a search or a catalogue page, so that a detail read does not have to ask the
// platform again (its detail endpoint is the play endpoint, which an account must have access to).
const seenSongs = new Map<string, UnifiedSong>();
const SEEN_SONGS_LIMIT = 500;

const rememberSong = (song: UnifiedSong): UnifiedSong => {
    seenSongs.delete(String(song.id));
    seenSongs.set(String(song.id), song);
    while (seenSongs.size > SEEN_SONGS_LIMIT) {
        const oldest = seenSongs.keys().next();
        if (oldest.done) break;
        seenSongs.delete(oldest.value);
    }
    return song;
};

const normalizeSeenSong = (raw: unknown): UnifiedSong => rememberSong(normalizeHuaweiSong(raw));

let activeLoginKey: string | null = null;
let lastKnownUser: ProviderUser | null = null;

const RECOMMENDATION_TTL_MS = 10 * 60 * 1000;
let recommendationCache: { at: number; answer: HuaweiRecommendationAnswer } | null = null;
let dailyCache: { day: string; songs: Promise<UnifiedSong[]> } | null = null;
let fmSeed: string | null = null;
let recommendationEpoch = 0;

/** Forget account-scoped reads and invalidate their in-flight responses. Also used by tests. */
export const resetHuaweiRecommendationCache = (): void => {
    recommendationEpoch += 1;
    recommendationCache = null;
    dailyCache = null;
    fmSeed = null;
};

const loadHuaweiRecommendations = async (): Promise<HuaweiRecommendationAnswer> => {
    const epoch = recommendationEpoch;
    const now = Date.now();
    if (recommendationCache && now - recommendationCache.at < RECOMMENDATION_TTL_MS) {
        return recommendationCache.answer;
    }
    const answer = await requestHuawei<HuaweiRecommendationAnswer>('recommendations');
    if (epoch !== recommendationEpoch) return { items: [] };
    recommendationCache = { at: now, answer };
    return answer;
};

const pickFmSeed = async (): Promise<string | null> => {
    const epoch = recommendationEpoch;
    try {
        const { items: playlists } = await listHuaweiPlaylists();
        if (epoch !== recommendationEpoch) return null;
        const liked = playlists.find(item => item.isOwned && item.name.includes('喜欢'))
            ?? playlists.find(item => item.isOwned);
        if (liked) {
            const page = await requestHuawei<HuaweiPlaylistTracksAnswer>('playlist_tracks', {
                id: String(liked.id), kind: 'owned', limit: 1, offset: 0,
            });
            const first = Array.isArray(page.items) ? page.items[0] : null;
            if (epoch !== recommendationEpoch) return null;
            if (first) return String(normalizeHuaweiSong(first).id);
        }
    } catch {
        // Without an account, or without a readable playlist, the daily list is the seed.
    }
    if (epoch !== recommendationEpoch) return null;
    const daily = await loadHuaweiDailySongs().catch(() => []);
    return epoch === recommendationEpoch && daily.length > 0 ? String(daily[0].id) : null;
};

const loadHuaweiDailySongs = (refresh = false): Promise<UnifiedSong[]> => {
    const epoch = recommendationEpoch;
    const day = new Date().toISOString().slice(0, 10);
    if (!refresh && dailyCache?.day === day) return dailyCache.songs;
    const songs = loadHuaweiRecommendations()
        .then(async answer => {
            if (epoch !== recommendationEpoch) return [];
            const id = answer.dailyId || 'a001';
            const page = await requestHuawei<HuaweiPlaylistTracksAnswer>('playlist_tracks', {
                id, kind: 'collected', limit: 50, offset: 0,
            });
            return epoch === recommendationEpoch ? (Array.isArray(page.items) ? page.items : []).map(normalizeHuaweiSong) : [];
        })
        .catch((error: unknown) => {
            if (dailyCache?.songs === songs) dailyCache = null;
            throw error;
        });
    dailyCache = { day, songs };
    return songs;
};

const huaweiLoginTexts: LoginTexts = {
    title: 'home.loginTitleHuawei',
    note: 'home.loginNoteHuawei',
};

const describeHuaweiLoginFailure = (step: string, error: unknown): LoginFailureDetail | null => {
    if (!(error instanceof OnlineProviderError)) return null;
    const base = {
        message: error.message,
        ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}),
    };
    if (error.code === 'network') return { ...base, case: 'unreachable' };
    if (error.code === 'unavailable') return { ...base, case: 'local-service-stopped' };
    if (error.code === 'auth-required') {
        const unfinished = step === 'open' || step === 'start'
            || /关闭|打不开|malformed|mismatch|missing/i.test(error.message);
        return { ...base, case: unfinished ? 'browser-unfinished' : 'not-authorized' };
    }
    return base;
};

const searchHuaweiSongs = async (query: string, limit: number, offset: number) => {
    const text = query.trim();
    if (!text) return huaweiPage<UnifiedSong>([], offset, false, 0);
    const answer = await requestHuawei<HuaweiSearchAnswer>('search', { query: text, limit, offset, kind: 'song' });
    const items = (Array.isArray(answer.items) ? answer.items : []).map(normalizeSeenSong);
    return huaweiPage(
        items,
        answer.nextOffset ?? offset + items.length,
        Boolean(answer.hasMore),
        answer.total,
    );
};

const searchHuaweiCollections = async (
    kind: 'album' | 'playlist',
    query: string,
    limit: number,
    offset: number,
) => {
    const text = query.trim();
    if (!text) return huaweiPage<ProviderCollection>([], offset, false, 0);
    const answer = await requestHuawei<HuaweiSearchAnswer>('search', { query: text, limit, offset, kind });
    const items = (Array.isArray(answer.items) ? answer.items : []).map(raw => normalizeHuaweiCollection(raw, kind));
    return huaweiPage(
        items,
        answer.nextOffset ?? offset + items.length,
        Boolean(answer.hasMore),
        answer.total,
    );
};

const getHuaweiSongDetail = async (id: MediaId): Promise<UnifiedSong | null> => {
    const cached = seenSongs.get(String(id));
    if (cached) return cached;
    // Playback/auth refusals must retain their error code; null means the song does not exist.
    const answer = await requestHuawei('song_detail', { id: String(id) });
    return answer ? normalizeSeenSong(answer) : null;
};

const getHuaweiAudioSource = async (song: SongResult, quality: ProviderAudioSource['quality']): Promise<ProviderAudioSource> => {
    const id = String(song.sourceRef?.kind === 'online' ? song.sourceRef.mediaId : song.id);
    const answer = await requestHuawei<HuaweiAudioAnswer>('audio', { id, quality });
    if (!answer.url) throw new OnlineProviderError('not-playable', 'Huawei Music returned no audio URL', 'huawei');
    const fetchedAt = typeof answer.fetchedAt === 'number' && Number.isFinite(answer.fetchedAt) ? answer.fetchedAt : Date.now();
    return {
        url: answer.url,
        fetchedAt,
        quality: (answer.quality || quality) as ProviderAudioSource['quality'],
        ...(answer.preview ? { preview: true } : {}),
    };
};

const getHuaweiLyrics = async (song: SongResult): Promise<ProviderLyricsResult> => {
    const id = String(song.sourceRef?.kind === 'online' ? song.sourceRef.mediaId : song.id);
    const data = await requestHuawei<HuaweiLyricAnswer>('lyrics', { id, lyricUrl: huaweiLyricUrl(song) })
        .catch(() => ({ lrc: '', hmrc: '' }));
    const text = typeof data.lrc === 'string' ? data.lrc : '';
    if (isPureMusicLyricText(text)) {
        return { lyrics: null, mainText: text, isPureMusic: true };
    }
    const parsed = text ? parseLyricsByFormat('lrc', text, '') : null;
    if (!hasRenderableLyrics(parsed)) {
        return { lyrics: null, mainText: text || null, isPureMusic: false };
    }
    return { lyrics: parsed, mainText: text, isPureMusic: false };
};

const checkHuaweiLogin = async (key: string): Promise<LoginState> => {
    try {
        const answer = await requestHuawei<{ state: LoginState['state'] }>('login_check', { key });
        if (answer.state === 'confirmed') {
            resetHuaweiRecommendationCache();
            lastKnownUser = normalizeHuaweiUser(await requestHuawei('login_status'));
        }
        return answer;
    } catch (error) {
        if (error instanceof OnlineProviderError) {
            const failure = describeHuaweiLoginFailure('check', error);
            return { state: 'error', message: error.message, ...(failure ? { failure } : {}) };
        }
        return { state: 'error', message: 'Huawei Music sign-in failed' };
    }
};

export const huaweiProvider: OnlineMusicProvider = {
    id: 'huawei',
    displayName: '华为音乐',
    shortName: '华为',
    shortNameKey: 'onlineProviderName.huawei',
    mark: { letter: '华', color: '#C7000B' },
    getAvailability: getHuaweiTransportAvailability,
    describeFailure: (operation, error) => {
        const detail = describeHuaweiFailure(error);
        if (!detail) return null;
        if (operation === 'audio' && error instanceof OnlineProviderError && error.code === 'auth-required' && !lastKnownUser) {
            return { ...detail, signedOut: true };
        }
        return detail;
    },
    capabilities: {
        search: true,
        playback: true,
        lyrics: true,
        wordByWordLyrics: false,
        auth: true,
        albums: true,
        artists: true,
        userLibrary: true,
        playlists: true,
        userAlbums: true,
        recommendations: true,
        mutations: false,
    },
    normalizeSong: normalizeHuaweiSong,
    normalizeUser: normalizeHuaweiUser,
    normalizeCollection: (raw, type) => normalizeHuaweiCollection(
        raw,
        type === 'artist' || type === 'playlist' ? type : 'album',
    ),
    songMetadata: { getSongMetadata: createProviderSongMetadata },
    search: {
        searchSongs: searchHuaweiSongs,
        searchAlbums: (query, limit, offset) => searchHuaweiCollections('album', query, limit, offset),
        searchPlaylists: (query, limit, offset) => searchHuaweiCollections('playlist', query, limit, offset),
    },
    playback: {
        getSongDetail: getHuaweiSongDetail,
        getAudioSource: getHuaweiAudioSource,
    },
    lyrics: {
        getLyrics: getHuaweiLyrics,
    },
    auth: {
        recheckOnWindowReturn: true,
        getLoginTexts: () => huaweiLoginTexts,
        async getLoginStatus() {
            const user = await requestHuawei('login_status');
            lastKnownUser = user ? normalizeHuaweiUser(user) : null;
            return lastKnownUser;
        },
        async logout() {
            activeLoginKey = null;
            lastKnownUser = null;
            seenSongs.clear();
            resetHuaweiRecommendationCache();
            await requestHuawei('logout');
        },
        signInRanOut() {
            lastKnownUser = null;
            resetHuaweiRecommendationCache();
        },
        async startLogin() {
            resetHuaweiRecommendationCache();
            const answer = await requestHuawei<{ key: string }>('login_start');
            activeLoginKey = answer.key;
            return answer.key;
        },
        async openLoginPage(key) {
            if (key !== activeLoginKey) return;
            await requestHuawei('login_open', { key });
        },
        checkLogin: checkHuaweiLogin,
        describeLoginFailure: describeHuaweiLoginFailure,
        async cancelLogin(key) {
            if (key !== activeLoginKey) return;
            activeLoginKey = null;
            await requestHuawei('login_cancel', { key });
        },
        getLoginTtlMs: () => LOGIN_TTL_MS,
    },
    recommendations: {
        // Huawei's recommendation page exposes "今日为你推荐" and "歌单推荐" columns.
        // Daily songs read its ordinary a001 playlist, not the unverified NEXT daily API.
        async getRecommendedCollections(limit) {
            const answer = await loadHuaweiRecommendations();
            return (Array.isArray(answer.items) ? answer.items : [])
                .filter(item => !item.daily)
                .slice(0, Math.max(0, limit))
                .map(huaweiPlaylistCollection);
        },
        getDailySongs: refresh => loadHuaweiDailySongs(refresh),
        // Similar-song radio seeded from an account playlist (or the daily list),
        // rather than Huawei's native "Listen now" service.
        async getPersonalFm() {
            const epoch = recommendationEpoch;
            const seed = fmSeed ?? await pickFmSeed();
            if (epoch !== recommendationEpoch || !seed) return [];
            const answer = await requestHuawei<HuaweiSimilarAnswer>('similar_songs', { id: seed });
            if (epoch !== recommendationEpoch) return [];
            const songs = (Array.isArray(answer.items) ? answer.items : [])
                .map(normalizeHuaweiSong)
                .filter(song => String(song.id) !== seed);
            if (songs.length > 0) fmSeed = String(songs[songs.length - 1].id);
            return songs;
        },
    },
    library: {
        async getUserAlbums(userId, limit, offset) {
            const answer = await requestHuawei<HuaweiAlbumAnswer>('library_albums', { limit, offset });
            const items = (Array.isArray(answer.items) ? answer.items : []).map(item => ({
                providerId: 'huawei' as const,
                id: item.id,
                type: 'album',
                name: item.name,
                ...(item.coverUrl ? { coverUrl: item.coverUrl } : {}),
                ...(typeof item.trackCount === 'number' ? { trackCount: item.trackCount } : {}),
                ...(item.artistName ? { artists: [{ id: '', name: item.artistName }] } : {}),
                ...(item.description ? { description: item.description } : {}),
            }));
            return huaweiPage(
                items,
                answer.nextOffset ?? offset + items.length,
                Boolean(answer.hasMore),
            );
        },
        async getUserPlaylists(userId, limit, offset) {
            return listHuaweiPlaylists(limit, offset);
        },
    },
    catalog: huaweiCatalog,
};
