import { useCallback, useEffect, useRef } from 'react';
import { omni } from '../services/onlineMusic/omni';
import {
    clearProviderAccountSnapshot,
    loadProviderAccountSnapshot,
    saveProviderAccountSnapshot,
} from '../services/onlineMusic/providerAccountCache';
import { useOnlineProviderAccountStore } from '../stores/useOnlineProviderAccountStore';
import { OnlineProviderError } from '../types/onlineMusic';
import type { MediaId, ProviderCollection } from '../types/onlineMusic';

// src/hooks/useSpotifyLibrary.ts
// Spotify 用户曲库生命周期与数据同步 Hook：管理 Spotify 用户歌单、收藏歌曲的加载与本地持久化缓存

export const useSpotifyLibrary = () => {
    const generation = useRef(0);
    const pendingSave = useRef<Promise<unknown>>(Promise.resolve());

    const refresh = useCallback(async () => {
        const current = ++generation.current;
        const store = useOnlineProviderAccountStore.getState();

        try {
            if (!omni.getProviderAvailability('spotify').configured || !omni.getProviderCapabilities('spotify').auth) {
                store.clearAccount('spotify');
                await pendingSave.current.catch(() => {});
                await clearProviderAccountSnapshot('spotify');
                return false;
            }

            store.updateAccount('spotify', { freshness: 'refreshing', error: undefined });
            const user = await omni.getLoginStatus('spotify');
            if (generation.current !== current) return false;

            if (!user) {
                store.clearAccount('spotify');
                await pendingSave.current.catch(() => {});
                await clearProviderAccountSnapshot('spotify');
                return false;
            }

            const visibleUser = useOnlineProviderAccountStore.getState().accounts.spotify?.user;
            if (!visibleUser || String(visibleUser.id) !== String(user.id)) {
                store.clearAccount('spotify');
                const snapshot = await loadProviderAccountSnapshot('spotify').catch(() => null);
                if (generation.current !== current) return false;
                const matching = snapshot && String(snapshot.user.id) === String(user.id) ? snapshot : null;
                store.updateAccount('spotify', {
                    status: 'authenticated',
                    user,
                    collections: matching?.collections || [],
                    likedSongIds: matching?.likedSongIds || [],
                    hydration: 'ready',
                    freshness: 'refreshing',
                    lastUpdatedAt: matching?.savedAt,
                    error: undefined,
                });
            }

            const likesBeforeRefresh = useOnlineProviderAccountStore.getState().accounts.spotify?.likedSongIds || [];
            const collections: ProviderCollection[] = [];
            const capabilities = omni.getProviderCapabilities('spotify');
            let offset = 0;

            if (capabilities.userLibrary) {
                while (true) {
                    const page = await omni.getProviderUserPlaylists('spotify', user.id, { offset, limit: 50 });
                    if (generation.current !== current) return false;
                    collections.push(...page.items);
                    if (!page.hasMore || page.nextOffset <= offset) break;
                    offset = page.nextOffset;
                }
            }

            const fetchedLikedSongIds: MediaId[] = capabilities.likes
                ? await omni.getProviderLikedSongIds('spotify', user.id)
                : [];
            if (generation.current !== current) return false;

            const save = pendingSave.current.catch(() => {}).then(() => {
                if (generation.current !== current) return null;
                const latestLikes = useOnlineProviderAccountStore.getState().accounts.spotify?.likedSongIds || [];
                const likedSongIds = latestLikes === likesBeforeRefresh ? fetchedLikedSongIds : latestLikes;
                store.updateAccount('spotify', {
                    status: 'authenticated',
                    user,
                    collections,
                    likedSongIds,
                    hydration: 'ready',
                    error: undefined,
                });
                return saveProviderAccountSnapshot('spotify', { user, collections, likedSongIds });
            });

            pendingSave.current = save;
            const saved = await save;
            if (generation.current !== current) return false;
            if (!saved) return false;

            store.updateAccount('spotify', { freshness: 'fresh', lastUpdatedAt: saved.savedAt });
            return true;
        } catch (error) {
            if (generation.current !== current) return false;
            if (error instanceof OnlineProviderError && error.code === 'auth-required') {
                store.clearAccount('spotify', 'auth-required');
                await pendingSave.current.catch(() => {});
                await clearProviderAccountSnapshot('spotify');
            } else {
                store.updateAccount('spotify', {
                    hydration: 'ready',
                    freshness: 'error',
                    status: useOnlineProviderAccountStore.getState().accounts.spotify?.user ? 'authenticated' : 'error',
                    error: 'spotify-refresh-failed',
                });
            }
            return false;
        }
    }, []);

    const logout = useCallback(async () => {
        generation.current++;
        useOnlineProviderAccountStore.getState().clearAccount('spotify');
        await pendingSave.current.catch(() => {});
        await Promise.all([omni.logout('spotify'), clearProviderAccountSnapshot('spotify')]);
    }, []);

    useEffect(() => {
        useOnlineProviderAccountStore.getState().clearAccount('spotify');
        void refresh();
        return () => {
            generation.current++;
        };
    }, [refresh]);

    return { refresh, logout };
};
