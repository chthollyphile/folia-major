// @vitest-environment jsdom
// @builtin-sources
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { answerNeteaseBackend, lazyNetease } from '../helpers/neteaseSource';
import { omni } from '@/services/onlineMusic/omni';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';

// test/unit/onlineMusic/neteaseAccountKept.test.ts
// What the NetEase source keeps of a sign-in on this machine, and when it goes: the cookie in the page's storage
// (folium.sources.pageStore, the same key as before it was a source mod). The page's storage is a map of texts, so
// what is kept is seen letter for letter; NetEase itself is `fetch` (at the embedded API's port the main entry
// answers with), answered by the test. The four caches builds from before the account snapshot kept the account in
// are not read any more (the source has no oldKeptAccount): the tests of them went with it.

const neteaseProvider = lazyNetease();

const stored = vi.hoisted(() => new Map<string, string>());
// Keys that cannot be read: db.ts answers null for a read that failed, as for a key that is not there.
const unreadable = vi.hoisted(() => new Set<string>());
// Keys that cannot be written: the save rejects.
const unwritable = vi.hoisted(() => new Set<string>());
vi.mock('@/services/db', async importOriginal => ({
    ...(await importOriginal<typeof import('@/services/db')>()),
    saveToCache: async (key: string, data: unknown) => {
        if (unwritable.has(key)) throw new Error('quota');
        stored.set(key, JSON.stringify(data));
    },
    getFromCache: async (key: string) => (stored.has(key) && !unreadable.has(key) ? JSON.parse(stored.get(key)!) : null),
    removeFromCache: async (key: string) => { stored.delete(key); },
    removeCacheEntries: async (keys: string[]) => { keys.forEach(key => stored.delete(key)); },
}));

const NOW = 1760000000000;
const COOKIE_KEY = 'online_provider:netease:cookie';
const SNAPSHOT_KEY = 'online_provider_netease_user_home_snapshot';
const OLD_KEYS = {
    user: 'online_provider_netease_user_profile',
    playlists: 'online_provider_netease_user_playlists',
    liked: 'online_provider_netease_user_liked_songs',
    cloud: 'online_provider_netease_user_cloud_playlist',
};
// As NetEase gave them, which is how those builds kept them.
const OLD_USER = '{"userId":7,"nickname":"Listener","avatarUrl":"http://img.test/a.jpg","vipType":11}';
const OLD_PLAYLISTS = '[{"id":1,"name":"Mine","coverImgUrl":"http://img.test/1.jpg","trackCount":3,"creator":{"userId":7,"nickname":"Listener"}}]';

const page = new Map<string, string>();
const fetchMock = vi.fn();
const account = () => useOnlineProviderAccountStore.getState().accounts.netease;
// A request the test answers when it chooses to.
const held = () => {
    let refuse!: (error: unknown) => void;
    const promise = new Promise<never>((_resolve, reject) => { refuse = reject; });
    return { promise, refuse };
};

beforeEach(() => {
    stored.clear();
    unreadable.clear();
    unwritable.clear();
    page.clear();
    fetchMock.mockReset();
    answerNeteaseBackend();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => page.get(key) ?? null,
        setItem: (key: string, value: string) => { page.set(key, value); },
        removeItem: (key: string) => { page.delete(key); },
    });
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    useOnlineProviderAccountStore.setState({ accounts: {}, activeProviderId: 'netease' });
});

describe('what NetEase keeps of a sign-in', () => {
    it('signs out: NetEase is told with the cookie, which has left the page before the first wait', async () => {
        page.set(COOKIE_KEY, 'MUSIC_U=abc');
        stored.set(SNAPSHOT_KEY, '"left to the read of the account"');
        const request = held();
        fetchMock.mockReturnValue(request.promise);

        const signedOut = neteaseProvider.auth!.logout();
        expect(page.has(COOKIE_KEY)).toBe(false);
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        // Only the path and the cookie: the address in front is this machine's (.env.local wins over the stub).
        expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/logout\?cookie=MUSIC_U%3Dabc$/);
        request.refuse(new Error('offline'));

        await expect(signedOut).rejects.toThrow('offline');
        expect(page.size).toBe(0);
        expect([...stored.keys()]).toEqual([SNAPSHOT_KEY]);
    });

    it('after a sign-out, the caches of an older build bring no account back at the next start', async () => {
        stored.set('user_profile', OLD_USER);
        stored.set(OLD_KEYS.user, OLD_USER);
        stored.set(OLD_KEYS.playlists, OLD_PLAYLISTS);
        // NetEase answers the sign-out, and then names nobody.
        fetchMock.mockImplementation(async () => Response.json({ code: 200, data: { code: 200, profile: null } }));

        await omni.signOutAccount('netease');
        await expect(omni.readAccount('netease', 'start')).resolves.toBe('nobody');

        expect(account()).toMatchObject({ status: 'anonymous', user: null, collections: [], likedSongIds: [] });
        expect(account().error).toBeUndefined();
        // (They are left where they are: nothing reads them.)
    });

    it('a sign-in that ran out: the cookie it was asked with goes, the one of a build before it was kept under the name of the source too, and NetEase is asked nothing more', async () => {
        page.set(COOKIE_KEY, 'MUSIC_U=abc');
        page.set('netease_cookie', 'MUSIC_U=older');
        // NetEase says the cookie signs nobody in.
        fetchMock.mockImplementation(async () => Response.json({ code: 301 }));
        await expect(neteaseProvider.auth!.getLoginStatus()).resolves.toBeNull();

        await neteaseProvider.auth!.signInRanOut!();

        expect(page.size).toBe(0);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    // A cookie the login status came with would be that request's own, maybe without MUSIC_U.
    it('keeps the cookie of the sign-in where the login status comes with a cookie of its own', async () => {
        page.set(COOKIE_KEY, 'MUSIC_U=abc');
        const profile = { userId: 7, nickname: 'Listener' };
        fetchMock.mockImplementation(async (url: unknown) => Response.json(String(url).includes('/login/status')
            ? { data: { code: 200, account: { id: 7 }, profile }, cookie: '__csrf=x' }
            : { code: 200, account: { id: 7 }, profile }));

        await expect(neteaseProvider.auth!.getLoginStatus()).resolves.toMatchObject({ id: '7', nickname: 'Listener' });
        expect(page.get(COOKIE_KEY)).toBe('MUSIC_U=abc');
    });

    it('a sign-in that ran out while a sign-in by QR code wrote a new cookie: the new cookie stays', async () => {
        let answer!: (response: Response) => void;
        fetchMock.mockReturnValue(new Promise<Response>(resolve => { answer = resolve; }));

        const read = omni.readAccount('netease', 'start');
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        // The sign-in is confirmed (checkLogin writes the cookie) before the answer to the start comes.
        page.set(COOKIE_KEY, 'MUSIC_U=new');
        answer(Response.json({ data: { code: 200, account: null, profile: null } }));

        await expect(read).resolves.toBe('nobody');
        expect(page.get(COOKIE_KEY)).toBe('MUSIC_U=new');
    });
});
