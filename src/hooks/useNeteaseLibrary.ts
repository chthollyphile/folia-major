import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { clearCache, getCacheUsage, getFromCache, openDB, saveToCache } from '../services/db';
import { neteaseApi } from '../services/netease';
import { NeteasePlaylist, NeteaseUser } from '../types';

type StatusSetter = Dispatch<SetStateAction<{ type: 'error' | 'success' | 'info', text: string; } | null>>;

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

export function useNeteaseLibrary({
    currentView,
    selectedPlaylist,
    selectedAlbumId,
    selectedArtistId,
    setStatusMsg,
    t,
}: {
    currentView: 'home' | 'player';
    selectedPlaylist: NeteasePlaylist | null;
    selectedAlbumId: number | null;
    selectedArtistId: number | null;
    setStatusMsg: StatusSetter;
    t: (key: string) => string;
}) {
    const [user, setUser] = useState<NeteaseUser | null>(null);
    const [playlists, setPlaylists] = useState<NeteasePlaylist[]>([]);
    const [likedSongIds, setLikedSongIds] = useState<Set<number>>(new Set());
    const [isSyncing, setIsSyncing] = useState(false);
    const [cacheSize, setCacheSize] = useState<string>('0 B');
    const lastCheckTimeRef = useRef<number>(0);

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
        } catch (error) {
            console.log('Not logged in or offline');
        }
        return false;
    }, []);

    const loadUserData = useCallback(async () => {
        const cachedUser = await getFromCache<NeteaseUser>('user_profile');
        const cachedPlaylists = await getFromCache<NeteasePlaylist[]>('user_playlists');
        const cachedLikedSongs = await getFromCache<number[]>('user_liked_songs');

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
            return;
        }

        refreshUserData();
    }, [refreshUserData]);

    const checkAndUpdatePlaylists = useCallback(async () => {
        if (!user) return;

        try {
            const newPlaylists = await getAllUserPlaylists(user.userId);
            if (!newPlaylists || newPlaylists.length === 0) return;

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
        const preserveKeys = ['user_profile', 'user_playlists', 'user_liked_songs', 'last_song', 'last_queue', 'last_theme'];

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
        localStorage.removeItem('netease_cookie');
        await clearCache();
        setUser(null);
        setPlaylists([]);
        setLikedSongIds(new Set());
        setStatusMsg({ type: 'info', text: t('status.loggedOut') });
    }, [setStatusMsg, t]);

    useEffect(() => {
        loadUserData();
    }, [loadUserData]);

    useEffect(() => {
        if (currentView === 'home' && user && !selectedPlaylist && !selectedAlbumId && !selectedArtistId) {
            const now = Date.now();
            if (now - lastCheckTimeRef.current > 10000) {
                lastCheckTimeRef.current = now;
                checkAndUpdatePlaylists();
            }
        }
    }, [checkAndUpdatePlaylists, currentView, selectedAlbumId, selectedArtistId, selectedPlaylist, user]);

    return {
        user,
        playlists,
        likedSongIds,
        isSyncing,
        cacheSize,
        refreshUserData,
        updateCacheSize,
        handleClearCache,
        handleSyncData,
        handleLogout,
        setLikedSongIds,
    };
}
