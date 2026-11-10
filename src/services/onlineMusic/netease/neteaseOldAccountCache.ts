import type { MediaId, ProviderCollection, ProviderUser } from '../../../types/onlineMusic';
import { removeCacheEntries } from '../../db';
import { getProviderCacheKey, getProviderCacheWithLegacyMigration } from '../providerStorage';

// src/services/onlineMusic/netease/neteaseOldAccountCache.ts
// What builds from before the account snapshot (providerAccountCache.ts) kept of the signed-in
// NetEase account: four caches, one each for the user, the playlists, the liked song ids and the
// cloud entry. Nothing writes them any more. They are read where no snapshot is found, so that a
// listener who comes from such a build sees the account at once, and they go when the account
// leaves. Once made the snapshot they go as well (the adapter's `forgetOldKeptAccount`).

const OLD_CACHES = ['user_profile', 'user_playlists', 'user_liked_songs', 'user_cloud_playlist'] as const;

/** The keys of the four caches. Clearing the cache leaves them, as it leaves the snapshots. */
export const neteaseOldAccountCacheKeys = (): string[] => OLD_CACHES.map(name => getProviderCacheKey('netease', name));

// One of the four, also from under the key it had before the caches were named by platform.
const readOld = (name: typeof OLD_CACHES[number]) => getProviderCacheWithLegacyMigration<unknown>('netease', name, [name]);

// The account the four caches hold, each part read by the adapter's own functions; null where they
// hold no user.
export const readNeteaseOldAccountCache = async (normalize: {
    user(raw: unknown): ProviderUser;
    collection(raw: unknown, type?: string): ProviderCollection;
}): Promise<{ user: ProviderUser; collections: ProviderCollection[]; likedSongIds: MediaId[] } | null> => {
    const user = await readOld('user_profile');
    if (user == null) return null;
    const playlists = await readOld('user_playlists');
    const likedSongIds = await readOld('user_liked_songs');
    const cloud = await readOld('user_cloud_playlist');
    return {
        user: normalize.user(user),
        collections: [
            ...(Array.isArray(playlists) ? playlists.map(playlist => normalize.collection(playlist, 'playlist')) : []),
            ...(cloud ? [normalize.collection(cloud, 'cloud')] : []),
        ],
        likedSongIds: Array.isArray(likedSongIds) ? likedSongIds as MediaId[] : [],
    };
};

// The four go from under both names: one left under its old name would be read again (`readOld`),
// and the account would come back.
export const removeNeteaseOldAccountCache = (): Promise<void> => removeCacheEntries([...neteaseOldAccountCacheKeys(), ...OLD_CACHES]);
