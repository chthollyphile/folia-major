import { useMemo } from 'react';
import { useOnlineProviderAccountStore } from '../stores/useOnlineProviderAccountStore';

// src/hooks/useNeteaseLibrary.ts
//
// What App needs of the NetEase account: the account as the account store holds it (it is read
// from NetEase like every platform's, src/services/onlineMusic/account/).

export function useNeteaseLibrary() {
    const account = useOnlineProviderAccountStore(state => state.accounts.netease);
    const user = account?.user ?? null;
    const collections = account?.collections;
    const playlists = useMemo(() => (collections || []).filter(collection => collection.type === 'playlist'), [collections]);
    const cloudPlaylist = useMemo(() => (collections || []).find(collection => collection.type === 'cloud') ?? null, [collections]);

    return {
        user,
        playlists,
        cloudPlaylist,
    };
}
