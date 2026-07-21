import { useCallback, useEffect } from 'react';
import { omni } from '../services/onlineMusic/omni';
import { useOnlineProviderAccountStore } from '../stores/useOnlineProviderAccountStore';
import type { MediaId, ProviderCollection } from '../types/onlineMusic';
import {
    clearProviderAccountSnapshot,
    loadProviderAccountSnapshot,
    saveProviderAccountSnapshot,
} from '../services/onlineMusic/providerAccountCache';

// src/hooks/useKugouLibrary.ts

const PAGE_SIZE = 50;

export const useKugouLibrary = () => {
    const updateAccount = useOnlineProviderAccountStore(state => state.updateAccount);
    const clearAccount = useOnlineProviderAccountStore(state => state.clearAccount);

    const refresh = useCallback(async () => {
        const availability = omni.getProviderAvailability('kugou');
        console.info('[KugouLibrary] refresh:start', { configured: availability.configured });
        if (!omni.getProviderCapabilities('kugou').auth || !availability.configured) {
            updateAccount('kugou', {
                status: availability.configured ? 'error' : 'anonymous',
                user: null,
                error: availability.reason,
                hydration: 'ready',
                freshness: availability.configured ? 'error' : 'fresh',
            });
            console.warn('[KugouLibrary] refresh:unavailable', { reason: availability.reason });
            return false;
        }

        const cachedAccount = useOnlineProviderAccountStore.getState().accounts.kugou;
        updateAccount('kugou', {
            status: cachedAccount?.user ? 'authenticated' : 'unknown',
            hydration: cachedAccount?.user ? 'ready' : 'loading',
            freshness: 'refreshing',
            error: undefined,
        });
        try {
            const user = await omni.getLoginStatus('kugou');
            if (!user) {
                clearAccount('kugou');
                await clearProviderAccountSnapshot('kugou');
                console.info('[KugouLibrary] refresh:anonymous');
                return false;
            }

            updateAccount('kugou', { status: 'authenticated', user, hydration: 'ready', error: undefined });
            console.info('[KugouLibrary] refresh:authenticated', {
                hasAvatar: Boolean(user.avatarUrl),
            });

            const collections: ProviderCollection[] = [];
            let likedSongIds: MediaId[] = [];
            try {
                if (omni.getProviderCapabilities('kugou').likes) {
                    try {
                        likedSongIds = await omni.getProviderLikedSongIds('kugou', user.id);
                    } catch (error) {
                        console.warn('[KugouLibrary] liked-songs:error', {
                            name: error instanceof Error ? error.name : 'Error',
                            message: error instanceof Error ? error.message : String(error),
                        });
                    }
                }
                if (omni.getProviderCapabilities('kugou').userLibrary) {
                    let offset = 0;
                    let hasMore = true;
                    while (hasMore && offset < 1000) {
                        const page = await omni.getProviderUserPlaylists('kugou', user.id, { limit: PAGE_SIZE, offset });
                        collections.push(...page.items);
                        console.info('[KugouLibrary] playlists:page', {
                            offset,
                            itemCount: page.items.length,
                            hasMore: page.hasMore,
                        });
                        hasMore = page.hasMore && page.nextOffset > offset;
                        offset = page.nextOffset;
                    }
                }
                if (omni.getProviderCapabilities('kugou').userCloud) {
                    collections.push({
                        providerId: 'kugou', id: 'cloud', name: '音乐云盘', type: 'cloud',
                        coverUrl: user.avatarUrl,
                    });
                }
                const snapshot = await saveProviderAccountSnapshot('kugou', { user, collections, likedSongIds });
                updateAccount('kugou', {
                    status: 'authenticated',
                    user,
                    collections,
                    likedSongIds,
                    error: undefined,
                    hydration: 'ready',
                    freshness: 'fresh',
                    lastUpdatedAt: snapshot.savedAt,
                });
                console.info('[KugouLibrary] refresh:complete', {
                    collectionCount: collections.length,
                    likedSongCount: likedSongIds.length,
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : 'kugou_library_failed';
                updateAccount('kugou', {
                    status: 'authenticated',
                    user,
                    error: message,
                    hydration: 'ready',
                    freshness: 'error',
                });
                console.warn('[KugouLibrary] playlists:error', {
                    name: error instanceof Error ? error.name : 'Error',
                    message,
                });
            }
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'kugou_refresh_failed';
            const retainedAccount = useOnlineProviderAccountStore.getState().accounts.kugou;
            updateAccount('kugou', {
                status: retainedAccount?.user ? 'authenticated' : 'error',
                error: message,
                hydration: 'ready',
                freshness: 'error',
            });
            console.warn('[KugouLibrary] refresh:error', {
                name: error instanceof Error ? error.name : 'Error',
                message,
            });
            return false;
        }
    }, [clearAccount, updateAccount]);

    const logout = useCallback(async () => {
        await omni.logout('kugou');
        clearAccount('kugou');
        await clearProviderAccountSnapshot('kugou');
    }, [clearAccount]);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const snapshot = await loadProviderAccountSnapshot('kugou');
            if (cancelled) return;
            if (snapshot) {
                const user = omni.normalizeCachedUser('kugou', snapshot.user);
                if (user) {
                    const collections = snapshot.collections
                        .map(collection => omni.normalizeCachedCollection('kugou', collection, collection.type))
                        .filter(Boolean) as ProviderCollection[];
                    updateAccount('kugou', {
                        status: 'authenticated',
                        user,
                        collections,
                        likedSongIds: snapshot.likedSongIds,
                        hydration: 'ready',
                        freshness: 'stale',
                        lastUpdatedAt: snapshot.savedAt,
                    });
                }
            }
            if (!cancelled) void refresh();
        })();
        return () => { cancelled = true; };
    }, [refresh]);

    return { refresh, logout };
};
