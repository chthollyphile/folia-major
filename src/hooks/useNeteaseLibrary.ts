import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { clearCache, getCacheUsage, getFromCache, openDB, saveToCache } from '../services/db';
import { neteaseApi } from '../services/netease';
import { NeteasePlaylist, NeteaseUser, StatusMessage } from '../types';

type StatusSetter = Dispatch<SetStateAction<StatusMessage | null>>;

const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const getAllUserPlaylists = async (uid: number): Promise<NeteasePlaylist[]> => {
    const allPlaylists: NeteasePlaylist[] = [];
    let offset = 0;
    const limit = 50;
    let hasMore = true;

    while (hasMore) {
        const response = await neteaseApi.getUserPlaylists(uid, limit, offset);
        if (response.playlist && response.playlist.length > 0) {
            allPlaylists.push(...response.playlist);
            hasMore = response.playlist.length === limit;
            offset += limit;
        } else {
            hasMore = false;
        }
    }

    return allPlaylists;
};

const getUserCloudPlaylist = async (user: NeteaseUser): Promise<NeteasePlaylist | null> => {
    const response = await neteaseApi.getUserCloud(1, 0);
    const trackCount = Number(response.count || 0);

    if (trackCount <= 0) {
        return null;
    }

    const coverImgUrl = response.songs?.[0]?.al?.picUrl || response.songs?.[0]?.album?.picUrl || user.avatarUrl;

    return {
        id: -100,
        name: '云盘',
        coverImgUrl,
        trackCount,
        playCount: 0,
        updateTime: Date.now(),
        trackUpdateTime: Date.now(),
        creator: user,
        description: '网易云音乐云盘',
        specialType: 'cloud',
    };
};

export function useNeteaseLibrary({
    currentView,
    hasOverlay,
    setStatusMsg,
    t,
}: {
    currentView: 'home' | 'player';
    hasOverlay: boolean;
    setStatusMsg: StatusSetter;
    t: (key: string) => string;
}) {
    const [user, setUser] = useState<NeteaseUser | null>(null);
    const [playlists, setPlaylists] = useState<NeteasePlaylist[]>([]);
    const [cloudPlaylist, setCloudPlaylist] = useState<NeteasePlaylist | null>(null);
    const [likedSongIds, setLikedSongIds] = useState<Set<number>>(new Set());
    const [isSyncing, setIsSyncing] = useState(false);
    const [cacheSize, setCacheSize] = useState<string>('0 B');
    const [isUserDataReady, setIsUserDataReady] = useState(false);
    const lastCheckTimeRef = useRef<number>(0);

    const clearAuthState = useCallback(async () => {
        localStorage.removeItem('netease_cookie');
        setUser(null);
        setPlaylists([]);
        setCloudPlaylist(null);
        setLikedSongIds(new Set());

        try {
            const db = await openDB();
            const tx = db.transaction(['user_cache', 'api_cache'], 'readwrite');
            const userStore = tx.objectStore('user_cache');
            const legacyStore = tx.objectStore('api_cache');

            ['user_profile', 'user_playlists', 'user_liked_songs', 'user_cloud_playlist'].forEach((key) => {
                userStore.delete(key);
                legacyStore.delete(key);
            });

            await new Promise<void>((resolve, reject) => {
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        } catch (error) {
            console.warn('Failed to clear auth cache', error);
        }
    }, []);

    const updateCacheSize = useCallback(async () => {
        const size = await getCacheUsage();
        setCacheSize(formatBytes(size));
    }, []);

    const refreshUserData = useCallback(async (uid?: number) => {
        try {
            const response = await neteaseApi.getLoginStatus();
            if (response.data && response.data.profile) {
                const profile = response.data.profile;
                setUser(profile);
                await saveToCache('user_profile', profile);
                if (response.cookie) localStorage.setItem('netease_cookie', response.cookie);

                const targetUid = uid || profile.userId;
                const allPlaylists = await getAllUserPlaylists(targetUid);
                if (allPlaylists.length > 0) {
                    setPlaylists(allPlaylists);
                    await saveToCache('user_playlists', allPlaylists);
                }

                try {
                    const nextCloudPlaylist = await getUserCloudPlaylist(profile);
                    setCloudPlaylist(nextCloudPlaylist);
                    await saveToCache('user_cloud_playlist', nextCloudPlaylist);
                } catch (error) {
                    console.warn('Failed to fetch user cloud playlist', error);
                    setCloudPlaylist(null);
                }

                try {
                    const likeRes = await neteaseApi.getLikedSongs(targetUid);
                    if (likeRes.ids) {
                        setLikedSongIds(new Set(likeRes.ids));
                        await saveToCache('user_liked_songs', likeRes.ids);
                    }
                } catch (error) {
                    console.warn('Failed to fetch liked songs', error);
                }

                return true;
            }

            await clearAuthState();
        } catch (error) {
            console.log('Not logged in or offline');
        }
        return false;
    }, [clearAuthState]);

    const loadUserData = useCallback(async () => {
        try {
            const cachedUser = await getFromCache<NeteaseUser>('user_profile');
            const cachedPlaylists = await getFromCache<NeteasePlaylist[]>('user_playlists');
            const cachedLikedSongs = await getFromCache<number[]>('user_liked_songs');
            const cachedCloudPlaylist = await getFromCache<NeteasePlaylist | null>('user_cloud_playlist');

            if (cachedUser) {
                setUser(cachedUser);
                if (cachedPlaylists) {
                    setPlaylists(cachedPlaylists);
                } else {
                    refreshUserData(cachedUser.userId);
                }

                if (cachedLikedSongs) {
                    setLikedSongIds(new Set(cachedLikedSongs));
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

    const checkAndUpdatePlaylists = useCallback(async () => {
        if (!user) return;

        try {
            const newPlaylists = await getAllUserPlaylists(user.userId);
            if (!newPlaylists || newPlaylists.length === 0) return;
            const nextCloudPlaylist = await getUserCloudPlaylist(user);

            const cachedPlaylists = await getFromCache<NeteasePlaylist[]>('user_playlists');

            if (!cachedPlaylists) {
                setPlaylists(newPlaylists);
                await saveToCache('user_playlists', newPlaylists);
                return;
            }

            const cachedMap = new Map<number, NeteasePlaylist>();
            cachedPlaylists.forEach(playlist => {
                cachedMap.set(playlist.id, playlist);
            });

            const changedPlaylistIds: number[] = [];
            let likedSongsPlaylistChanged = false;

            newPlaylists.forEach((newPlaylist, index) => {
                const oldPlaylist = cachedMap.get(newPlaylist.id);
                const isLikedSongsPlaylist = index === 0;

                if (!oldPlaylist) {
                    changedPlaylistIds.push(newPlaylist.id);
                    if (isLikedSongsPlaylist) likedSongsPlaylistChanged = true;
                    return;
                }

                const trackTimeChanged = (newPlaylist.trackUpdateTime || 0) !== (oldPlaylist.trackUpdateTime || 0);
                const updateTimeChanged = (newPlaylist.updateTime || 0) !== (oldPlaylist.updateTime || 0);

                if (trackTimeChanged || updateTimeChanged) {
                    changedPlaylistIds.push(newPlaylist.id);
                    if (isLikedSongsPlaylist) likedSongsPlaylistChanged = true;
                }
            });

            const newPlaylistIds = new Set(newPlaylists.map(playlist => playlist.id));
            cachedPlaylists.forEach(oldPlaylist => {
                if (!newPlaylistIds.has(oldPlaylist.id)) {
                    changedPlaylistIds.push(oldPlaylist.id);
                }
            });

            if (changedPlaylistIds.length > 0) {
                try {
                    const db = await openDB();
                    const tx = db.transaction(['metadata_cache'], 'readwrite');
                    const store = tx.objectStore('metadata_cache');

                    const deletePromises = changedPlaylistIds.flatMap(playlistId => [
                        new Promise<void>((resolve, reject) => {
                            const req = store.delete(`playlist_tracks_${playlistId}`);
                            req.onsuccess = () => resolve();
                            req.onerror = () => reject(req.error);
                        }),
                        new Promise<void>((resolve, reject) => {
                            const req = store.delete(`playlist_detail_${playlistId}`);
                            req.onsuccess = () => resolve();
                            req.onerror = () => reject(req.error);
                        })
                    ]);

                    await Promise.all(deletePromises);
                } catch (error) {
                    console.error('[PlaylistSync] Failed to clear cache', error);
                }
            }

            setPlaylists(newPlaylists);
            await saveToCache('user_playlists', newPlaylists);
            setCloudPlaylist(nextCloudPlaylist);
            await saveToCache('user_cloud_playlist', nextCloudPlaylist);

            if (likedSongsPlaylistChanged && newPlaylists.length > 0) {
                try {
                    const likeRes = await neteaseApi.getLikedSongs(user.userId);
                    if (likeRes.ids) {
                        setLikedSongIds(new Set(likeRes.ids));
                        await saveToCache('user_liked_songs', likeRes.ids);
                    }
                } catch (error) {
                    console.warn('[PlaylistSync] Failed to refetch liked songs', error);
                }
            }
        } catch (error) {
            console.error('[PlaylistSync] Failed to check playlists', error);
        }
    }, [user]);

    const handleClearCache = useCallback(async () => {
        const preserveKeys = ['user_profile', 'user_playlists', 'user_liked_songs', 'user_cloud_playlist', 'last_song', 'last_queue', 'last_theme'];

        try {
            const db = await openDB();
            const tx = db.transaction(['metadata_cache'], 'readonly');
            const store = tx.objectStore('metadata_cache');
            const allKeys = await new Promise<string[]>((resolve, reject) => {
                const request = store.getAllKeys();
                request.onsuccess = () => resolve(request.result as string[]);
                request.onerror = () => reject(request.error);
            });

            const playlistKeys = allKeys.filter(key =>
                key.startsWith('playlist_tracks_') || key.startsWith('playlist_detail_')
            );

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
        try {
            await refreshUserData(user.userId);
            updateCacheSize();
            setStatusMsg({ type: 'success', text: t('status.dataSynced') });
        } catch (error) {
            setStatusMsg({ type: 'error', text: t('status.syncFailed') });
        } finally {
            setIsSyncing(false);
        }
    }, [refreshUserData, setStatusMsg, t, updateCacheSize, user]);

    const handleLogout = useCallback(async () => {
        try {
            await neteaseApi.logout();
        } catch (error) {
            console.warn('Failed to notify logout endpoint', error);
        }

        await clearAuthState();
        setStatusMsg({ type: 'info', text: t('status.loggedOut') });
    }, [clearAuthState, setStatusMsg, t]);

    useEffect(() => {
        loadUserData();
    }, [loadUserData]);

    useEffect(() => {
        if (currentView === 'home' && user && !hasOverlay) {
            const now = Date.now();
            if (now - lastCheckTimeRef.current > 10000) {
                lastCheckTimeRef.current = now;
                checkAndUpdatePlaylists();
            }
        }
    }, [checkAndUpdatePlaylists, currentView, hasOverlay, user]);

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
