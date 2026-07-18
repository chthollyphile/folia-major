import { OnlineProviderError } from '../../types/onlineMusic';
import { readProviderSessionValue, writeProviderSessionValue } from './providerStorage';

// src/services/onlineMusic/kugouTransport.ts

export const KUGOU_OPERATIONS = [
    'register_dev', 'login_qr_key', 'login_qr_create', 'login_qr_check', 'logout',
    'user_detail', 'user_playlist', 'user_cloud', 'user_cloud_url', 'search',
    'audio', 'song_url', 'search_lyric', 'lyric', 'playlist_track_all',
    'album_detail', 'album_songs', 'artist_detail', 'artist_albums', 'artist_audios',
    'everyday_recommend', 'everyday_history', 'personal_fm', 'playlist_add',
    'playlist_del', 'playlist_tracks_add', 'playlist_tracks_del',
] as const;

export type KugouOperation = typeof KUGOU_OPERATIONS[number];
export type KugouParams = Record<string, string | number | boolean | undefined>;

const ENDPOINTS: Record<KugouOperation, string> = {
    register_dev: '/register/dev',
    login_qr_key: '/login/qr/key',
    login_qr_create: '/login/qr/create',
    login_qr_check: '/login/qr/check',
    logout: '/logout',
    user_detail: '/user/detail',
    user_playlist: '/user/playlist',
    user_cloud: '/user/cloud',
    user_cloud_url: '/user/cloud/url',
    search: '/search',
    audio: '/audio',
    song_url: '/song/url',
    search_lyric: '/search/lyric',
    lyric: '/lyric',
    playlist_track_all: '/playlist/track/all',
    album_detail: '/album/detail',
    album_songs: '/album/songs',
    artist_detail: '/artist/detail',
    artist_albums: '/artist/albums',
    artist_audios: '/artist/audios',
    everyday_recommend: '/everyday/recommend',
    everyday_history: '/everyday/history',
    personal_fm: '/personal/fm',
    playlist_add: '/playlist/add',
    playlist_del: '/playlist/del',
    playlist_tracks_add: '/playlist/tracks/add',
    playlist_tracks_del: '/playlist/tracks/del',
};

const getWebApiBase = (): string => {
    const value = typeof import.meta !== 'undefined'
        ? String((import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_KUGOU_API_BASE || '')
        : '';
    return value.trim().replace(/\/$/, '');
};

const persistWebSession = (response: any): void => {
    const cookies = response?.cookie || response?.data?.cookie;
    if (typeof cookies === 'string' && cookies) writeProviderSessionValue('kugou', 'cookie', cookies);
    if (Array.isArray(cookies) && cookies.length) writeProviderSessionValue('kugou', 'cookie', cookies.join('; '));

    const payload = response?.data || response?.body?.data || response?.body || response;
    const token = payload?.token;
    const userId = payload?.userid ?? payload?.user_id;
    const dfid = payload?.dfid;
    if (token) writeProviderSessionValue('kugou', 'token', String(token));
    if (userId) writeProviderSessionValue('kugou', 'userid', String(userId));
    if (dfid) writeProviderSessionValue('kugou', 'dfid', String(dfid));
};

export const getKugouTransportAvailability = () => {
    if (typeof window !== 'undefined' && window.electron?.kugouRequest) return { configured: true } as const;
    return getWebApiBase()
        ? { configured: true } as const
        : { configured: false, reason: 'not-configured' as const };
};

// Routes one provider request through Electron IPC or an explicitly configured Web backend.
export const requestKugou = async <T = any>(operation: KugouOperation, params: KugouParams = {}): Promise<T> => {
    if (typeof window !== 'undefined' && window.electron?.kugouRequest) {
        return window.electron.kugouRequest(operation, params) as Promise<T>;
    }

    const base = getWebApiBase();
    if (!base) {
        throw new OnlineProviderError('unavailable', 'VITE_KUGOU_API_BASE is not configured', 'kugou');
    }

    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) query.set(key, String(value));
    });
    const cookie = readProviderSessionValue('kugou', 'cookie');
    const token = readProviderSessionValue('kugou', 'token');
    const userId = readProviderSessionValue('kugou', 'userid');
    const dfid = readProviderSessionValue('kugou', 'dfid');
    if (cookie) query.set('cookie', cookie);
    if (token && !query.has('token')) query.set('token', token);
    if (userId && !query.has('userid')) query.set('userid', userId);
    if (dfid && !query.has('dfid')) query.set('dfid', dfid);
    query.set('timestamp', String(Date.now()));

    const response = await fetch(`${base}${ENDPOINTS[operation]}?${query}`, { credentials: 'include' });
    if (!response.ok) {
        throw new OnlineProviderError('network', `KuGouMusicApi request failed: ${response.status}`, 'kugou');
    }
    const body = await response.json();
    persistWebSession(body);
    return (body?.body ?? body) as T;
};
