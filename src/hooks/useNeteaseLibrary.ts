import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
    clearCache,
    getCacheKeysByPrefix,
    getCacheUsage,
    removeCacheEntries,
    saveToCache,
} from '../services/db';
import {
    getProviderCacheKey,
    getProviderCacheWithLegacyMigration,
    removeProviderSessionValue,
} from '../services/onlineMusic/providerStorage';
import type { MediaId, ProviderCollection, ProviderUser } from '../types/onlineMusic';
import { StatusMessage } from '../types';
import { useOnlineProviderAccountStore } from '../stores/useOnlineProviderAccountStore';
import { omni } from '../services/onlineMusic/omni';

type StatusSetter = Dispatch<SetStateAction<StatusMessage | null>>;

const NETEASE_USER_CACHE_KEYS = {
    profile: getProviderCacheKey('netease', 'user_profile'),
    playlists: getProviderCacheKey('netease', 'user_playlists'),
    likedSongs: getProviderCacheKey('netease', 'user_liked_songs'),
    cloudPlaylist: getProviderCacheKey('netease', 'user_cloud_playlist'),
};

const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const getAllUserPlaylists = async (userId: MediaId): Promise<ProviderCollection[]> => {
    const allPlaylists: ProviderCollection[] = [];
    let offset = 0;
    const limit = 50;
    let hasMore = true;

    while (hasMore) {
        const page = await omni.getProviderUserPlaylists('netease', userId, { limit, offset });
        allPlaylists.push(...page.items);
        hasMore = page.hasMore && page.nextOffset > offset;
        offset = page.nextOffset;
    }

    return allPlaylists;
};

const getUserCloudPlaylist = async (user: ProviderUser, t: (key: string) => string): Promise<ProviderCollection | null> => {
    const collection = await omni.getProviderCloudCollection('netease', user);
    return collection ? {
        ...collection,
        name: t('navidrome.cloudDrive'),
        description: t('navidrome.cloudDriveDesc'),
    } : null;
};

export function useNeteaseLibrary({
    setStatusMsg,
    t,
}: {
    setStatusMsg: StatusSetter;
    t: (key: string) => string;
}) {
    const [user, setUser] = useState<ProviderUser | null>(null);
    const [playlists, setPlaylists] = useState<ProviderCollection[]>([]);
    const [cloudPlaylist, setCloudPlaylist] = useState<ProviderCollection | null>(null);
    const [likedSongIds, setLikedSongIds] = useState<Set<MediaId>>(new Set());
    const [isSyncing, setIsSyncing] = useState(false);
    const [cacheSize, setCacheSize] = useState<string>('0 B');
    const [isUserDataReady, setIsUserDataReady] = useState(false);
    const lastRefreshAuthExpiredRef = useRef(false);
    const updateProviderAccount = useOnlineProviderAccountStore(state => state.updateAccount);
    const clearProviderAccount = useOnlineProviderAccountStore(state => state.clearAccount);

    const clearAuthState = useCallback(async () => {
        removeProviderSessionValue('netease', 'cookie', ['netease_cookie']);
        setUser(null);
        setPlaylists([]);
        setCloudPlaylist(null);
        setLikedSongIds(new Set());
        clearProviderAccount('netease');

        try {
            await removeCacheEntries(Object.values(NETEASE_USER_CACHE_KEYS));
        } catch (error) {
            console.warn('Failed to clear auth cache', error);
        }
    }, [clearProviderAccount]);

    useEffect(() => {
        updateProviderAccount('netease', {
            status: user ? 'authenticated' : 'anonymous',
            user,
            collections: [...playlists, ...(cloudPlaylist ? [cloudPlaylist] : [])],
            likedSongIds: Array.from(likedSongIds),
        });
    }, [cloudPlaylist, likedSongIds, playlists, updateProviderAccount, user]);

    const updateCacheSize = useCallback(async () => {
        const size = await getCacheUsage();
        setCacheSize(formatBytes(size));
    }, []);

    const refreshUserData = useCallback(async (uid?: MediaId) => {
        lastRefreshAuthExpiredRef.current = false;
        try {
            const profile = await omni.getLoginStatus('netease');
            if (profile) {
                setUser(profile);
                await saveToCache(NETEASE_USER_CACHE_KEYS.profile, profile);

                const targetUid = uid ?? profile.id;
                const allPlaylists = await getAllUserPlaylists(targetUid);
                setPlaylists(allPlaylists);
                await saveToCache(NETEASE_USER_CACHE_KEYS.playlists, allPlaylists);

                try {
                    const nextCloudPlaylist = await getUserCloudPlaylist(profile, t);
                    setCloudPlaylist(nextCloudPlaylist);
                    await saveToCache(NETEASE_USER_CACHE_KEYS.cloudPlaylist, nextCloudPlaylist);
                } catch (error) {
                    console.warn('Failed to fetch user cloud playlist', error);
                    setCloudPlaylist(null);
                }

                try {
                    const ids = await omni.getProviderLikedSongIds('netease', targetUid);
                    if (ids) {
                        setLikedSongIds(new Set(ids));
                        await saveToCache(NETEASE_USER_CACHE_KEYS.likedSongs, ids);
                    }
                } catch (error) {
                    console.warn('Failed to fetch liked songs', error);
                }

                return true;
            }

            lastRefreshAuthExpiredRef.current = true;
            await clearAuthState();
        } catch (error) {
            console.log('Not logged in, session expired, or offline');
            if (error instanceof Error && error.message === 'NETEASE_AUTH_EXPIRED') {
                lastRefreshAuthExpiredRef.current = true;
                await clearAuthState();
            }
        }
        return false;
    }, [clearAuthState, t]);

    const loadUserData = useCallback(async () => {
        try {
            const cachedUserRaw = await getProviderCacheWithLegacyMigration<unknown>('netease', 'user_profile', ['user_profile']);
            const cachedPlaylistsRaw = await getProviderCacheWithLegacyMigration<unknown>('netease', 'user_playlists', ['user_playlists']);
            const cachedLikedSongs = await getProviderCacheWithLegacyMigration<unknown>('netease', 'user_liked_songs', ['user_liked_songs']);
            const cachedCloudPlaylistRaw = await getProviderCacheWithLegacyMigration<unknown>('netease', 'user_cloud_playlist', ['user_cloud_playlist']);
            const cachedUser: ProviderUser | null = cachedUserRaw != null
                ? omni.normalizeCachedUser('netease', cachedUserRaw)
                : null;
            const cachedPlaylists = Array.isArray(cachedPlaylistsRaw)
                ? cachedPlaylistsRaw.map(item => omni.normalizeCachedCollection('netease', item, 'playlist')).filter(Boolean) as ProviderCollection[]
                : [];
            const cachedCloudPlaylist = cachedCloudPlaylistRaw
                ? omni.normalizeCachedCollection('netease', cachedCloudPlaylistRaw, 'cloud')
                : null;

            if (cachedUser) {
                setUser(cachedUser);
                if (cachedPlaylists.length > 0) {
                    setPlaylists(cachedPlaylists);
                } else {
                    void refreshUserData(cachedUser.id);
                }

                if (Array.isArray(cachedLikedSongs)) {
                    setLikedSongIds(new Set(cachedLikedSongs as MediaId[]));
                }
                if (cachedCloudPlaylist) {
                    setCloudPlaylist(cachedCloudPlaylist);
                }
                return;
            }

            await refreshUserData();
        } finally {
            setIsUserDataReady(true);
        }
    }, [refreshUserData]);

    const handleClearCache = useCallback(async () => {
        const preserveKeys = [...Object.values(NETEASE_USER_CACHE_KEYS), 'last_song', 'last_queue', 'last_theme'];

        try {
            const playlistKeys = await getCacheKeysByPrefix([
                getProviderCacheKey('netease', 'playlist_tracks_'),
                getProviderCacheKey('netease', 'playlist_detail_'),
            ]);

            await clearCache([...preserveKeys, ...playlistKeys]);
            updateCacheSize();
            setStatusMsg({ type: 'success', text: t('status.cacheCleared') });
        } catch (error) {
            console.error('Failed to clear cache:', error);
            setStatusMsg({ type: 'error', text: t('status.cacheCleared') });
        }
    }, [setStatusMsg, t, updateCacheSize]);

    const handleSyncData = useCallback(async () => {
        if (!user) return;

        setIsSyncing(true);
        console.info('[NeteaseSync] Sync data requested', { userId: user.id });
        try {
            const synced = await refreshUserData(user.id);
            if (!synced) {
                console.info('[NeteaseSync] Sync data skipped because login is expired or unavailable', {
                    userId: user.id,
                    authExpired: lastRefreshAuthExpiredRef.current,
                });
                setStatusMsg({
                    type: 'error',
                    text: lastRefreshAuthExpiredRef.current ? t('status.loginExpired') : t('status.syncFailed'),
                });
                return;
            }
            updateCacheSize();
            console.info('[NeteaseSync] Sync data completed', { userId: user.id });
            setStatusMsg({ type: 'success', text: t('status.dataSynced') });
        } catch (error) {
            console.warn('[NeteaseSync] Sync data failed', error);
            setStatusMsg({ type: 'error', text: t('status.syncFailed') });
        } finally {
            setIsSyncing(false);
        }
    }, [refreshUserData, setStatusMsg, t, updateCacheSize, user]);

    const handleLogout = useCallback(async () => {
        try {
            await omni.logout('netease');
        } catch (error) {
            console.warn('Failed to notify logout endpoint', error);
        }

        await clearAuthState();
        setStatusMsg({ type: 'info', text: t('status.loggedOut') });
    }, [clearAuthState, setStatusMsg, t]);

    useEffect(() => {
        loadUserData();
    }, [loadUserData]);

    return {
        user,
        playlists,
        cloudPlaylist,
        likedSongIds,
        isSyncing,
        isUserDataReady,
        cacheSize,
        refreshUserData,
        updateCacheSize,
        handleClearCache,
        handleSyncData,
        handleLogout,
        setLikedSongIds,
    };
}
