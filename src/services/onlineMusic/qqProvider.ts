import type { SongResult } from '../../types';
import type {
    AudioQualityPreference,
    MediaId,
    OnlineMusicProvider,
    ProviderCollection,
    ProviderLyricsResult,
    ProviderPage,
    ProviderUser,
    QrLoginState,
} from '../../types/onlineMusic';
import { OnlineProviderError } from '../../types/onlineMusic';
import { createProviderSongMetadata } from '../../utils/songMetadata';
import { toSafePlaybackUrl } from '../../utils/appPlaybackHelpers';
import { fetchQQLyrics, searchQQLyrics } from '../../utils/lyrics/providers/qqLyricProvider';
import { writeProviderSessionValue } from './providerStorage';
import { normalizeQqCollection, normalizeQqSong, normalizeQqUser } from './qqNormalize';
import { clearQqSession, getQqTransportAvailability, hasQqSession, requestQq } from './qqTransport';

// src/services/onlineMusic/qqProvider.ts

const errorFields = (error: unknown) => ({
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
});

const searchSongs = async (query: string, limit: number, offset: number) => {
    // Reuses the QQ search that already backs lyric matching; only the provider contract is new.
    const results = await searchQQLyrics(query, Math.floor(offset / Math.max(1, limit)) + 1, limit);
    const items = results.map(normalizeQqSong);
    return { items, hasMore: items.length === limit, nextOffset: offset + items.length };
};

const QQ_QUALITY_FALLBACKS: Record<
    AudioQualityPreference,
    Array<{ apiQuality: '128' | '320' | 'flac'; resolvedQuality: AudioQualityPreference }>
> = {
    standard: [{ apiQuality: '128', resolvedQuality: 'standard' }],
    high: [
        { apiQuality: '320', resolvedQuality: 'high' },
        { apiQuality: '128', resolvedQuality: 'standard' },
    ],
    lossless: [
        { apiQuality: 'flac', resolvedQuality: 'lossless' },
        { apiQuality: '320', resolvedQuality: 'high' },
        { apiQuality: '128', resolvedQuality: 'standard' },
    ],
    // The current backend protocol exposes FLAC but no distinct Hi-Res tier.
    hires: [
        { apiQuality: 'flac', resolvedQuality: 'lossless' },
        { apiQuality: '320', resolvedQuality: 'high' },
        { apiQuality: '128', resolvedQuality: 'standard' },
    ],
};

const getQqSongMid = (song: SongResult): string => {
    const sourceRef = song.sourceRef?.kind === 'online' && song.sourceRef.providerId === 'qq'
        ? song.sourceRef
        : undefined;
    return String(song.qqMid || sourceRef?.providerData?.songMid || sourceRef?.mediaId || '').trim();
};

const loadRawPlaylistTracks = async (id: MediaId): Promise<{ tracks: unknown[]; total?: number }> => {
    const response = await requestQq<any>('song_list_detail', { disstid: String(id) });
    const detail = Array.isArray(response?.response?.cdlist) ? response.response.cdlist[0] : undefined;
    const tracks = Array.isArray(detail?.songlist) ? detail.songlist : [];
    const total = Number(detail?.total_song_num ?? detail?.songnum);
    return { tracks, ...(Number.isFinite(total) && total >= 0 ? { total } : {}) };
};

const loadRawLikedTracks = async (
    limit: number,
    offset: number,
): Promise<{ tracks: unknown[]; total?: number; more: boolean }> => {
    const response = await requestQq<any>('user_liked_songs', { offset, limit });
    const tracks = Array.isArray(response?.songs) ? response.songs : [];
    const total = Number(response?.total);
    return {
        tracks,
        ...(Number.isFinite(total) && total >= 0 ? { total } : {}),
        more: response?.more === true,
    };
};

const getPlaylistTracks = async (
    id: MediaId,
    limit: number,
    offset: number,
    collection?: ProviderCollection,
): Promise<ProviderPage<ReturnType<typeof normalizeQqSong>>> => {
    if (Number(collection?.providerData?.dirId) === 201) {
        const { tracks, total, more } = await loadRawLikedTracks(Math.max(1, limit), Math.max(0, offset));
        const items = tracks.map(normalizeQqSong);
        const nextOffset = offset + items.length;
        return {
            items,
            ...(total === undefined ? {} : { total }),
            hasMore: more || (total !== undefined && nextOffset < total),
            nextOffset,
        };
    }
    const { tracks, total } = await loadRawPlaylistTracks(id);
    const items = tracks
        .slice(offset, offset + Math.max(0, limit))
        .map(normalizeQqSong);
    const nextOffset = offset + items.length;
    return {
        items,
        ...(total === undefined ? {} : { total }),
        hasMore: nextOffset < tracks.length,
        nextOffset,
    };
};

const getSongDetail = async (id: MediaId) => {
    const response = await requestQq<any>('song_info', { songmid: String(id) });
    const track = response?.response?.songinfo?.data?.track_info;
    if (!track || typeof track !== 'object') return null;
    const song = normalizeQqSong(track);
    return song.qqMid ? song : null;
};

const getAudioSource = async (song: SongResult, quality: AudioQualityPreference) => {
    const songmid = getQqSongMid(song);
    if (!songmid) return null;
    const sourceRef = song.sourceRef?.kind === 'online' && song.sourceRef.providerId === 'qq'
        ? song.sourceRef
        : undefined;
    const mediaId = String(sourceRef?.providerData?.mediaMid || '').trim();

    // The backend answers HTTP 200 with an empty `url` plus an `error` string when the account may
    // not stream the song (membership, region, takedown). Without keeping that apart from a request
    // failure, an unplayable song looks exactly like a transient error worth retrying.
    let sawEmptyPlayLink = false;

    for (const candidate of QQ_QUALITY_FALLBACKS[quality]) {
        try {
            const response = await requestQq<any>('music_play', {
                songmid,
                ...(mediaId ? { mediaId } : {}),
                quality: candidate.apiQuality,
            });
            const direct = response?.data?.playUrl?.[songmid];
            const fallback = Object.values(response?.data?.playUrl ?? {})[0] as any;
            const entry = direct ?? fallback;
            const url = toSafePlaybackUrl(String(direct?.url || fallback?.url || ''));
            if (url) {
                return {
                    url,
                    fetchedAt: Date.now(),
                    quality: candidate.resolvedQuality,
                };
            }
            if (entry) {
                sawEmptyPlayLink = true;
            }
        } catch (error) {
            if (error instanceof OnlineProviderError && error.code === 'auth-required') throw error;
            console.warn('[QQProvider] playback:quality-failed', {
                requestedQuality: quality,
                candidateQuality: candidate.resolvedQuality,
                ...errorFields(error),
            });
        }
    }

    console.warn('[QQProvider] playback:no-source', {
        requestedQuality: quality,
        hasMediaMid: Boolean(mediaId),
        // `true` means the upstream answered normally but issued no stream for this account.
        upstreamRefusedPlayLink: sawEmptyPlayLink,
    });
    return null;
};

// Delegates to the existing QRC pipeline, which owns decryption, translation and romanization.
const getLyrics = async (song: SongResult): Promise<ProviderLyricsResult> => {
    const sourceRef = song.sourceRef?.kind === 'online' && song.sourceRef.providerId === 'qq'
        ? song.sourceRef
        : undefined;
    const songMid = song.qqMid || sourceRef?.mediaId || '';
    const songId = sourceRef?.providerData?.songId ?? song.id;
    if (!songMid || !songId) {
        console.warn('[QQProvider] lyrics:missing-identity', { hasSongMid: Boolean(songMid), hasSongId: Boolean(songId) });
        return { lyrics: null, isPureMusic: false };
    }

    const lyrics = await fetchQQLyrics({ ...song, id: songId as MediaId, qqMid: songMid });
    return { lyrics: lyrics ?? null, isPureMusic: false };
};

const getLoginStatus = async (): Promise<ProviderUser | null> => {
    // No opaque backend session means the account cannot be authenticated, so the startup request is skipped.
    if (!hasQqSession()) return null;

    try {
        const response = await requestQq<any>('login_status');
        const profile = response?.data?.profile;
        if (!profile) {
            console.info('[QQProvider] login-status:anonymous');
            return null;
        }
        const user = normalizeQqUser(profile);
        // The acceptance test account returned a profile without a display name, so the profile itself is the signal.
        console.info('[QQProvider] login-status:profile', {
            hasUserId: Boolean(user.id),
            hasNickname: Boolean(user.nickname),
        });
        return user;
    } catch (error) {
        // The backend keeps auth sessions in one process, so a restart or the 24h TTL also arrives as 401.
        if (error instanceof OnlineProviderError && error.code === 'auth-required') {
            console.info('[QQProvider] login-status:auth-required');
            return null;
        }
        console.warn('[QQProvider] login-status:error', errorFields(error));
        throw error;
    }
};

const logout = async (): Promise<void> => {
    if (hasQqSession()) {
        await requestQq('logout').catch(error => {
            console.warn('[QQProvider] logout:error', errorFields(error));
        });
    }
    clearQqSession();
};

const checkQr = async (key: string): Promise<QrLoginState> => {
    const response = await requestQq<any>('login_qr_check', { key });
    const code = Number(response?.code);
    if (code === 801) return { state: 'waiting' };
    if (code === 802) return { state: 'scanned' };
    if (code === 803) {
        // Idempotent with the transport, which already stored the opaque session string on this response.
        if (typeof response?.cookie === 'string' && response.cookie) {
            writeProviderSessionValue('qq', 'cookie', response.cookie);
        }
        return { state: 'confirmed' };
    }
    if (code === 800) {
        // 800 also carries an upstream rejection; `upstreamCode` is the upstream safety number, left unnamed.
        if (response?.upstreamCode !== undefined || response?.retryAfterMs !== undefined) {
            console.warn('[QQProvider] qr-check:upstream-rejected', {
                upstreamCode: response?.upstreamCode,
                retryAfterMs: response?.retryAfterMs,
            });
            return { state: 'error', message: response?.message };
        }
        return { state: 'expired' };
    }
    return { state: 'error', message: response?.message };
};

// `/user/playlist` returns the whole GetPlaylistByUin list and takes no upstream paging parameters,
// so the Omni page window is applied locally instead of being forwarded.
const getUserPlaylists = async (
    userId: MediaId,
    limit: number,
    offset: number,
): Promise<ProviderPage<ProviderCollection>> => {
    const uid = String(userId ?? '');
    // Without `uid` the backend falls back to the session account, which is the only account a session can read.
    const response = await requestQq<any>('user_playlist', uid ? { uid } : {});
    const playlists = Array.isArray(response?.playlist) ? response.playlist : [];
    const items = playlists
        .slice(offset, offset + Math.max(0, limit))
        .map((item: unknown) => normalizeQqCollection(item));
    const nextOffset = offset + items.length;
    const total = Number(response?.total);
    if (offset === 0) {
        // `more` reports an upstream continuation this endpoint cannot request, so it is only observable here.
        console.info('[QQProvider] playlists:loaded', {
            count: playlists.length,
            ...(Number.isFinite(total) ? { total } : {}),
            more: Boolean(response?.more),
        });
    }

    return {
        items,
        ...(Number.isFinite(total) && total >= 0 ? { total } : {}),
        hasMore: nextOffset < playlists.length,
        nextOffset,
    };
};

const getLikedSongIds = async (_userId: MediaId): Promise<MediaId[]> => {
    const tracks: unknown[] = [];
    let offset = 0;
    while (offset < 10000) {
        const page = await loadRawLikedTracks(100, offset);
        tracks.push(...page.tracks);
        const nextOffset = offset + page.tracks.length;
        if (page.tracks.length === 0 || (!page.more && (page.total === undefined || nextOffset >= page.total)))
            break;
        offset = nextOffset;
    }
    return tracks
        .map(normalizeQqSong)
        .map(item => item.sourceRef?.kind === 'online' ? item.sourceRef.mediaId : item.id)
        .filter((id): id is MediaId => id !== undefined && id !== null && id !== '');
};

export const qqProvider: OnlineMusicProvider = {
    id: 'qq',
    displayName: 'QQ Music',
    shortName: 'QQ音乐',
    getAvailability: getQqTransportAvailability,
    capabilities: {
        search: true,
        playback: true,
        lyrics: true,
        auth: true,
        userLibrary: true,
        playlists: true,
        albums: false,
        artists: false,
        recommendations: false,
        mutations: false,
        wordByWordLyrics: true,
        likes: true,
    },
    normalizeSong: normalizeQqSong,
    normalizeUser: normalizeQqUser,
    normalizeCollection: normalizeQqCollection,
    songMetadata: {
        getSongMetadata(song) {
            return createProviderSongMetadata(song);
        },
    },
    search: { searchSongs },
    playback: { getSongDetail, getAudioSource },
    lyrics: { getLyrics },
    auth: {
        getLoginStatus,
        logout,
        async getQrKey() {
            const response = await requestQq<any>('login_qr_key');
            return String(response?.data?.unikey || '');
        },
        async createQr(key) {
            const response = await requestQq<any>('login_qr_create', { key });
            return String(response?.data?.qrimg || '');
        },
        checkQr,
    },
    library: { getUserPlaylists, getLikedSongIds },
    catalog: { getPlaylistTracks },
};
