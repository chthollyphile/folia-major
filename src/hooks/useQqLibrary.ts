import { useCallback, useEffect } from 'react';
import { omni } from '../services/onlineMusic/omni';
import { useOnlineProviderAccountStore } from '../stores/useOnlineProviderAccountStore';
import type { OnlineProviderAccountState } from '../stores/useOnlineProviderAccountStore';
import type {
    MediaId,
    ProviderAvailability,
    ProviderCapabilities,
    ProviderCollection,
    ProviderPage,
    ProviderUser,
} from '../types/onlineMusic';
import {
    clearProviderAccountSnapshot,
    loadProviderAccountSnapshot,
    saveProviderAccountSnapshot,
} from '../services/onlineMusic/providerAccountCache';

// src/hooks/useQqLibrary.ts

const PAGE_SIZE = 50;

export type QqLibraryRefreshDeps = {
    availability: ProviderAvailability;
    capabilities: ProviderCapabilities;
    cachedUser: ProviderUser | null;
    checkLoginStatus: () => Promise<ProviderUser | null>;
    loadLikedSongIds: (userId: MediaId) => Promise<MediaId[]>;
    loadPlaylistPage: (userId: MediaId, limit: number, offset: number) => Promise<ProviderPage<ProviderCollection>>;
    saveSnapshot: (user: ProviderUser, collections: ProviderCollection[], likedSongIds: MediaId[]) => Promise<number>;
    updateAccount: (patch: Partial<OnlineProviderAccountState>) => void;
};

// QQ models liked songs as a built-in playlist and exposes no cloud drive.
export const refreshQqLibraryAccount = async ({
    availability,
    capabilities,
    cachedUser,
    checkLoginStatus,
    loadLikedSongIds,
    loadPlaylistPage,
    saveSnapshot,
    updateAccount,
}: QqLibraryRefreshDeps): Promise<boolean> => {
    console.info('[QQLibrary] refresh:start', { configured: availability.configured });
    if (!capabilities.auth || !availability.configured) {
        updateAccount({
            status: availability.configured ? 'error' : 'anonymous',
            user: null,
            error: availability.reason,
            hydration: 'ready',
            freshness: availability.configured ? 'error' : 'fresh',
        });
        console.warn('[QQLibrary] refresh:unavailable', { reason: availability.reason });
        return false;
    }

    updateAccount({
        status: cachedUser ? 'authenticated' : 'unknown',
        hydration: cachedUser ? 'ready' : 'loading',
        freshness: 'refreshing',
        error: undefined,
    });
    const user = await checkLoginStatus();
    if (!user) return false;

    // The acceptance test account has an empty upstream nickname, so the returned profile is the entire login signal.
    console.info('[QQLibrary] refresh:authenticated', {
        hasUserId: Boolean(user.id),
        hasNickname: Boolean(user.nickname),
    });

    const collections: ProviderCollection[] = [];
    let likedSongIds: MediaId[] = [];
    try {
        if (capabilities.likes) {
            try {
                likedSongIds = await loadLikedSongIds(user.id);
            } catch (error) {
                console.warn('[QQLibrary] liked-songs:error', {
                    name: error instanceof Error ? error.name : 'Error',
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        }
        if (capabilities.userLibrary) {
            let offset = 0;
            let hasMore = true;
            while (hasMore && offset < 1000) {
                const page = await loadPlaylistPage(user.id, PAGE_SIZE, offset);
                collections.push(...page.items);
                console.info('[QQLibrary] playlists:page', {
                    offset,
                    itemCount: page.items.length,
                    hasMore: page.hasMore,
                });
                hasMore = page.hasMore && page.nextOffset > offset;
                offset = page.nextOffset;
            }
        }
        const savedAt = await saveSnapshot(user, collections, likedSongIds);
        updateAccount({
            status: 'authenticated',
            user,
            collections,
            likedSongIds,
            error: undefined,
            hydration: 'ready',
            freshness: 'fresh',
            lastUpdatedAt: savedAt,
        });
        console.info('[QQLibrary] refresh:complete', {
            collectionCount: collections.length,
            likedSongCount: likedSongIds.length,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'qq_library_failed';
        updateAccount({
            status: 'authenticated',
            user,
            error: message,
            hydration: 'ready',
            freshness: 'error',
        });
        console.warn('[QQLibrary] playlists:error', {
            name: error instanceof Error ? error.name : 'Error',
            message,
        });
    }
    return true;
};

export const useQqLibrary = () => {
    const updateAccount = useOnlineProviderAccountStore(state => state.updateAccount);
    const clearAccount = useOnlineProviderAccountStore(state => state.clearAccount);

    // Clears the visible account first so a failed backend logout cannot leave stale authenticated UI behind.
    const clearAuthState = useCallback(async (error?: string) => {
        clearAccount('qq', error);
        console.info('[QQLibrary] auth-state-cleared', {
            reason: error || 'manual-logout',
        });
        const cleanupResults = await Promise.allSettled([
            omni.logout('qq'),
            clearProviderAccountSnapshot('qq'),
        ]);
        cleanupResults.forEach((result, index) => {
            if (result.status === 'fulfilled') return;
            console.warn('[QQLibrary] auth-cleanup:error', {
                target: index === 0 ? 'provider-session' : 'account-snapshot',
                name: result.reason instanceof Error ? result.reason.name : 'Error',
                message: result.reason instanceof Error ? result.reason.message : String(result.reason),
            });
        });
    }, [clearAccount]);

    const checkLoginStatus = useCallback(async (): Promise<ProviderUser | null> => {
        const cachedAccount = useOnlineProviderAccountStore.getState().accounts.qq;
        try {
            // A profile without a display name still counts as authenticated; the provider owns that judgement.
            const user = await omni.getLoginStatus('qq');
            if (!user) {
                await clearAuthState(cachedAccount?.user ? 'auth-required' : undefined);
                console.info('[QQLibrary] login-status:anonymous', {
                    previousAccountExpired: Boolean(cachedAccount?.user),
                });
                return null;
            }
            updateAccount('qq', {
                status: 'authenticated',
                user,
                hydration: 'ready',
                error: undefined,
            });
            return user;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'qq_login_status_failed';
            await clearAuthState(cachedAccount?.user ? 'auth-required' : undefined);
            console.warn('[QQLibrary] login-status:error', {
                hadCachedAccount: Boolean(cachedAccount?.user),
                name: error instanceof Error ? error.name : 'Error',
                message,
            });
            return null;
        }
    }, [clearAuthState, updateAccount]);

    const refresh = useCallback(() => refreshQqLibraryAccount({
        availability: omni.getProviderAvailability('qq'),
        capabilities: omni.getProviderCapabilities('qq'),
        cachedUser: useOnlineProviderAccountStore.getState().accounts.qq?.user || null,
        checkLoginStatus,
        loadLikedSongIds: userId => omni.getProviderLikedSongIds('qq', userId),
        loadPlaylistPage: (userId, limit, offset) => omni.getProviderUserPlaylists('qq', userId, { limit, offset }),
        saveSnapshot: async (user, collections, likedSongIds) => (
            (await saveProviderAccountSnapshot('qq', { user, collections, likedSongIds })).savedAt
        ),
        updateAccount: patch => updateAccount('qq', patch),
    }), [checkLoginStatus, updateAccount]);

    const logout = useCallback(async () => {
        await clearAuthState();
    }, [clearAuthState]);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const snapshot = await loadProviderAccountSnapshot('qq');
            if (cancelled) return;
            if (snapshot) {
                const user = omni.normalizeCachedUser('qq', snapshot.user);
                if (user) {
                    const collections = snapshot.collections
                        .map(collection => omni.normalizeCachedCollection('qq', collection, collection.type))
                        .filter(Boolean) as ProviderCollection[];
                    updateAccount('qq', {
                        status: 'authenticated',
                        user,
                        collections,
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

    return { refresh, logout, checkLoginStatus };
};
