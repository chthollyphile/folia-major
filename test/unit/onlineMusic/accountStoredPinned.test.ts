import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clearProviderAccountSnapshot,
    loadProviderAccountSnapshot,
    saveProviderAccountSnapshot,
} from '@/services/onlineMusic/providerAccountCache';
import { getProviderCacheKey, getProviderSessionKey } from '@/services/onlineMusic/providerStorage';

// test/unit/onlineMusic/accountStoredPinned.test.ts
// What is kept of a signed-in account between runs, written out letter for letter: under which
// key, and as which text. A change to how the accounts are read must leave every line here as it
// is: a text stored by an earlier build has to give the same account, and the same account has to
// give the same text.

const stored = vi.hoisted(() => new Map<string, string>());
// The cache as text, the way the disk holds it.
vi.mock('@/services/db', () => ({
    saveToCache: async (key: string, data: unknown) => { stored.set(key, JSON.stringify(data)); },
    getFromCache: async (key: string) => (stored.has(key) ? JSON.parse(stored.get(key)!) : null),
    removeFromCache: async (key: string) => { stored.delete(key); },
}));

const ACCOUNT = {
    user: { id: 42, nickname: 'Listener', avatarUrl: 'https://img.example/a.jpg', vipType: 1 },
    collections: [
        { providerId: 'qq', id: 'list-1', name: 'Own', type: 'playlist', isOwned: true, trackCount: 3 },
        { providerId: 'qq', id: 'cloud', name: 'Cloud', type: 'cloud' },
    ],
    likedSongIds: ['a', 7],
};
const TEXT = '{"version":1,"savedAt":1760000000000,'
    + '"user":{"id":42,"nickname":"Listener","avatarUrl":"https://img.example/a.jpg","vipType":1},'
    + '"collections":[{"providerId":"qq","id":"list-1","name":"Own","type":"playlist","isOwned":true,"trackCount":3},'
    + '{"providerId":"qq","id":"cloud","name":"Cloud","type":"cloud"}],'
    + '"likedSongIds":["a",7]}';

describe('what is stored of an account', () => {
    beforeEach(() => {
        stored.clear();
        vi.useFakeTimers();
        vi.setSystemTime(1760000000000);
    });
    afterEach(() => vi.useRealTimers());

    it.each(['netease', 'kugou', 'qq', 'bodian', 'ytm', 'spotify'])('keeps the account of %s under one key of its own', async providerId => {
        await saveProviderAccountSnapshot(providerId, ACCOUNT);
        expect([...stored.keys()]).toEqual([`online_provider_${providerId}_user_home_snapshot`]);
    });

    it('this account gives this stored text', async () => {
        await saveProviderAccountSnapshot('qq', ACCOUNT);
        expect(stored.get('online_provider_qq_user_home_snapshot')).toBe(TEXT);
    });

    it('this stored text gives this account', async () => {
        stored.set('online_provider_qq_user_home_snapshot', TEXT);
        await expect(loadProviderAccountSnapshot('qq')).resolves.toEqual({ version: 1, savedAt: 1760000000000, ...ACCOUNT });
    });

    it('a text an older build stored, with row ids and an id that is none, gives the account without them', async () => {
        stored.set('online_provider_kugou_user_home_snapshot', '{"version":1,"savedAt":5,"user":{"id":"u"},"collections":[],'
            + '"likedSongIds":["HASH-A","",null,12],"likedSongFileIds":{"HASH-A":987}}');
        await expect(loadProviderAccountSnapshot('kugou')).resolves.toEqual({
            version: 1, savedAt: 5, user: { id: 'u' }, collections: [], likedSongIds: ['HASH-A', 12],
        });
    });

    it.each([
        ['of another version', '{"version":2,"savedAt":5,"user":{"id":"u"},"collections":[],"likedSongIds":[]}'],
        ['without a user', '{"version":1,"savedAt":5,"collections":[],"likedSongIds":[]}'],
        ['without the liked ids', '{"version":1,"savedAt":5,"user":{"id":"u"},"collections":[]}'],
    ])('a text %s gives no account', async (_what, text) => {
        stored.set('online_provider_ytm_user_home_snapshot', text);
        await expect(loadProviderAccountSnapshot('ytm')).resolves.toBeNull();
    });

    it('a sign-out takes the one key away and no other', async () => {
        await saveProviderAccountSnapshot('qq', ACCOUNT);
        await saveProviderAccountSnapshot('kugou', ACCOUNT);
        await clearProviderAccountSnapshot('qq');
        expect([...stored.keys()]).toEqual(['online_provider_kugou_user_home_snapshot']);
    });

    it('names the keys of the sign-in data and of the caches before the snapshot as they are on disk', () => {
        expect(getProviderSessionKey('netease', 'cookie')).toBe('online_provider:netease:cookie');
        expect(getProviderSessionKey('qq', 'cookie')).toBe('online_provider:qq:cookie');
        expect(['cookie', 'token', 'userid', 'dfid'].map(key => getProviderSessionKey('kugou', key))).toEqual([
            'online_provider:kugou:cookie', 'online_provider:kugou:token', 'online_provider:kugou:userid', 'online_provider:kugou:dfid',
        ]);
        expect(['user_profile', 'user_playlists', 'user_liked_songs', 'user_cloud_playlist'].map(key => getProviderCacheKey('netease', key))).toEqual([
            'online_provider_netease_user_profile', 'online_provider_netease_user_playlists',
            'online_provider_netease_user_liked_songs', 'online_provider_netease_user_cloud_playlist',
        ]);
    });
});
