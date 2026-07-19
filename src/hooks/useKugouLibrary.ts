import { useCallback, useEffect } from 'react';
import { omni } from '../services/onlineMusic/omni';
import { useOnlineProviderAccountStore } from '../stores/useOnlineProviderAccountStore';
import type { ProviderCollection } from '../types/onlineMusic';

// src/hooks/useKugouLibrary.ts

const PAGE_SIZE = 50;

export const useKugouLibrary = () => {
    const updateAccount = useOnlineProviderAccountStore(state => state.updateAccount);
    const clearAccount = useOnlineProviderAccountStore(state => state.clearAccount);

    const refresh = useCallback(async () => {
        const availability = omni.getProviderAvailability('kugou');
        console.info('[KugouLibrary] refresh:start', { configured: availability.configured });
        if (!omni.getProviderCapabilities('kugou').auth || !availability.configured) {
            updateAccount('kugou', { status: availability.configured ? 'error' : 'anonymous', user: null, error: availability.reason });
            console.warn('[KugouLibrary] refresh:unavailable', { reason: availability.reason });
            return false;
        }

        updateAccount('kugou', { status: 'unknown', error: undefined });
        try {
            const user = await omni.getLoginStatus('kugou');
            if (!user) {
                clearAccount('kugou');
                console.info('[KugouLibrary] refresh:anonymous');
                return false;
            }

            updateAccount('kugou', { status: 'authenticated', user, collections: [], error: undefined });
            console.info('[KugouLibrary] refresh:authenticated', {
                hasAvatar: Boolean(user.avatarUrl),
            });

            const collections: ProviderCollection[] = [];
            try {
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
                updateAccount('kugou', { status: 'authenticated', user, collections, error: undefined });
                console.info('[KugouLibrary] refresh:complete', { collectionCount: collections.length });
            } catch (error) {
                const message = error instanceof Error ? error.message : 'kugou_library_failed';
                updateAccount('kugou', { status: 'authenticated', user, collections: [], error: message });
                console.warn('[KugouLibrary] playlists:error', {
                    name: error instanceof Error ? error.name : 'Error',
                    message,
                });
            }
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'kugou_refresh_failed';
            updateAccount('kugou', {
                status: 'error',
                error: message,
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
    }, [clearAccount]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    return { refresh, logout };
};
