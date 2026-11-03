import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { omni } from '@/services/onlineMusic/omni';
import { registerOnlineMusicProvider, unregisterOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import type { UnifiedSong } from '@/types';
import { OnlineProviderError } from '@/types/onlineMusic';
import type { OnlineAuthProvider, OnlineLibraryProvider, OnlineMusicProvider, OnlineMutationProvider, ProviderCollection, ProviderLikedSongIds, ProviderUser } from '@/types/onlineMusic';

// test/unit/onlineMusic/accountRead.test.ts
// The one read of an account (account/accountRead.ts) through omni, against an adapter the test
// makes: what is asked of the platform, what the account store shows meanwhile and after, and
// what is kept on disk. The disk is a map of texts, so what is saved is seen letter for letter.
//
// The read knows no platform. The platforms differ in what their adapters say of themselves, and
// one thing they say changes the read: whether what was kept of the account shows at once at app
// start (`showsKeptAccountAtStart`: NetEase, KuGou, QQ) or waits for the platform to name the user
// (Bodian, YouTube Music, Spotify). Every case below that does not hang on it runs for both kinds.

const stored = vi.hoisted(() => new Map<string, string>());
// A test may hold the disk (`held`): a write asked for meanwhile waits, and the writes land in the
// order they were asked for. `asked` counts the writes asked for.
const disk = vi.hoisted(() => ({ held: null as Promise<void> | null, asked: 0 }));
vi.mock('@/services/db', async importOriginal => ({
    ...(await importOriginal<typeof import('@/services/db')>()),
    saveToCache: async (key: string, data: unknown) => {
        const text = JSON.stringify(data);
        disk.asked += 1;
        if (disk.held) await disk.held;
        stored.set(key, text);
    },
    getFromCache: async (key: string) => (stored.has(key) ? JSON.parse(stored.get(key)!) : null),
    removeFromCache: async (key: string) => { stored.delete(key); },
}));

const NOW = 1760000000000;
const user: ProviderUser = { id: 'abc', nickname: 'Listener' };
// A provider of its own for every test: the reads keep what is under way for each provider.
let providerId = '';
let made = 0;
let showsKeptAccountAtStart = false;
type Page = { items: ProviderCollection[]; hasMore: boolean; nextOffset: number };
const list = (id: string, more: Partial<ProviderCollection> = {}): ProviderCollection => ({ providerId, type: 'playlist', id, name: id, ...more });
const onePage = (...ids: string[]): Page => ({ items: ids.map(id => list(id)), hasMore: false, nextOffset: ids.length });
const song = (mediaId: string): UnifiedSong => ({
    id: mediaId, name: mediaId, artists: [], album: { id: '', name: '' }, durationMs: 1,
    sourceRef: { kind: 'online', providerId, mediaId },
});
const account = () => useOnlineProviderAccountStore.getState().accounts[providerId];
const snapshotKey = () => `online_provider_${providerId}_user_home_snapshot`;
const keep = (kept: { user: ProviderUser; collections?: ProviderCollection[]; likedSongIds?: string[] }) => {
    stored.set(snapshotKey(), JSON.stringify({ version: 1, savedAt: 5, collections: [], likedSongIds: [], ...kept }));
};
// A request the test answers when it chooses to.
const held = <T,>() => {
    let answer!: (value: T) => void;
    let refuse!: (error: unknown) => void;
    const promise = new Promise<T>((resolve, reject) => { answer = resolve; refuse = reject; });
    return { promise, answer, refuse };
};
const refused = () => new OnlineProviderError('auth-required', 'refused', providerId);

const platform = (over: { auth?: Partial<OnlineAuthProvider>; library?: Partial<OnlineLibraryProvider>; mutations?: Partial<OnlineMutationProvider>; configured?: boolean; normalizes?: boolean } = {}) => {
    const auth = {
        getLoginStatus: vi.fn(async (): Promise<ProviderUser | null> => user),
        logout: vi.fn(async () => {}),
        showsKeptAccountAtStart,
        ...over.auth,
    };
    const library = {
        getUserPlaylists: vi.fn(async (): Promise<Page> => onePage('one')),
        getLikedSongIds: vi.fn(async (): Promise<ProviderLikedSongIds> => ({ ids: ['liked-1'], whole: true })),
        ...over.library,
    };
    const provider: OnlineMusicProvider = {
        id: providerId,
        displayName: providerId,
        getAvailability: () => (over.configured === false ? { configured: false, reason: 'runtime-unavailable' } : { configured: true }),
        capabilities: {
            search: false, playback: true, lyrics: false, auth: true, userLibrary: true,
            playlists: true, albums: false, artists: false, recommendations: false,
            mutations: true, likes: true, wordByWordLyrics: false,
        },
        normalizeSong: raw => raw as never,
        // An adapter that reads what an older build kept: here it marks what went through it.
        ...(over.normalizes ? {
            normalizeUser: (raw: unknown) => ({ ...(raw as ProviderUser), nickname: 'As the adapter reads it' }),
            normalizeCollection: (raw: unknown, type?: string) => ({ ...(raw as ProviderCollection), type: type ?? 'playlist', description: 'as the adapter reads it' }),
        } : {}),
        auth,
        library,
        mutations: { likeSong: vi.fn(async () => {}), ...over.mutations },
    };
    registerOnlineMusicProvider(provider);
    return { auth, library };
};

let log: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    made += 1;
    providerId = `account-read-test-${made}`;
    showsKeptAccountAtStart = false;
    stored.clear();
    disk.held = null;
    disk.asked = 0;
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    unregisterOnlineMusicProvider(providerId);
    useOnlineProviderAccountStore.setState({ accounts: {}, activeProviderId: 'netease' });
});

describe('app start, where the kept account waits for the platform to name the user', () => {
    it('shows nobody until the platform has answered, and nobody after it names nobody', async () => {
        keep({ user, collections: [list('kept')] });
        const status = held<ProviderUser | null>();
        platform({ auth: { getLoginStatus: vi.fn(() => status.promise) } });

        const read = omni.readAccount(providerId, 'start');
        expect(account()).toMatchObject({ status: 'anonymous', hydration: 'ready', user: null, collections: [], freshness: 'refreshing' });
        status.answer(null);

        await expect(read).resolves.toBe('nobody');
        expect(account()).toMatchObject({ status: 'anonymous', user: null, collections: [], freshness: 'fresh' });
        expect(account().error).toBeUndefined();
        expect(stored.has(snapshotKey())).toBe(false);
        expect(log).toHaveBeenCalledWith(`[Account] ${providerId}: start: nobody is signed in`);
    });

    it('shows what was kept of the user the platform names while it reads, then what it read, and keeps that as this text', async () => {
        keep({ user, collections: [list('kept')], likedSongIds: ['kept-like'] });
        const page = held<Page>();
        const { auth, library } = platform({ library: { getUserPlaylists: vi.fn(() => page.promise) } });

        const read = omni.readAccount(providerId, 'start');
        await vi.waitFor(() => expect(library.getUserPlaylists).toHaveBeenCalledWith('abc', 50, 0));
        expect(account()).toMatchObject({ status: 'authenticated', user, collections: [{ id: 'kept' }], likedSongIds: ['kept-like'], freshness: 'refreshing', lastUpdatedAt: 5 });
        page.answer({ items: [list('one', { isOwned: true })], hasMore: false, nextOffset: 1 });

        await expect(read).resolves.toBe('read');
        expect(auth.getLoginStatus).toHaveBeenCalledTimes(1);
        expect(library.getLikedSongIds).toHaveBeenCalledExactlyOnceWith('abc');
        expect(account()).toMatchObject({ status: 'authenticated', user, collections: [{ id: 'one' }], likedSongIds: ['liked-1'], freshness: 'fresh', lastUpdatedAt: NOW });
        expect(stored.get(snapshotKey())).toBe(`{"version":1,"savedAt":${NOW},"user":{"id":"abc","nickname":"Listener"},`
            + `"collections":[{"providerId":"${providerId}","type":"playlist","id":"one","name":"one","isOwned":true}],"likedSongIds":["liked-1"]}`);
        expect(log).toHaveBeenCalledWith(`[Account] ${providerId}: start: read: 1 playlists, 1 of them the account's own; 1 liked songs read`);
    });

    it('shows nothing that was kept of another user', async () => {
        keep({ user: { id: 'someone-else', nickname: 'Other' }, collections: [list('theirs')], likedSongIds: ['their-like'] });
        const liked = held<ProviderLikedSongIds>();
        platform({ library: { getUserPlaylists: vi.fn(async () => onePage()), getLikedSongIds: vi.fn(() => liked.promise) } });

        const read = omni.readAccount(providerId, 'start');
        await vi.waitFor(() => expect(account()?.user).toEqual(user));
        expect(account()).toMatchObject({ collections: [], likedSongIds: [] });
        liked.answer({ ids: [], whole: true });
        await expect(read).resolves.toBe('read');
    });
});

describe('app start, where the kept account shows at once', () => {
    beforeEach(() => { showsKeptAccountAtStart = true; });

    it('shows the kept account, as the adapter reads it, while the platform is asked, and keeps it shown when the platform cannot be asked', async () => {
        keep({ user, collections: [list('kept')], likedSongIds: ['kept-like'] });
        const status = held<ProviderUser | null>();
        const { library } = platform({ auth: { getLoginStatus: vi.fn(() => status.promise) }, normalizes: true });

        const read = omni.readAccount(providerId, 'start');
        await vi.waitFor(() => expect(account()?.user).toBeTruthy());
        expect(account()).toMatchObject({
            status: 'authenticated', hydration: 'ready', freshness: 'refreshing', lastUpdatedAt: 5,
            user: { id: 'abc', nickname: 'As the adapter reads it' },
            collections: [{ id: 'kept', description: 'as the adapter reads it' }],
            likedSongIds: ['kept-like'],
        });
        const text = stored.get(snapshotKey());
        status.refuse(new Error('offline'));

        await expect(read).resolves.toBe('unknown');
        expect(account()).toMatchObject({ status: 'authenticated', user: { id: 'abc' }, collections: [{ id: 'kept' }], likedSongIds: ['kept-like'], freshness: 'error', error: 'offline' });
        expect(library.getUserPlaylists).not.toHaveBeenCalled();
        expect(stored.get(snapshotKey())).toBe(text);
    });

    it('shows the account as being found out while nobody is shown and the platform is asked', async () => {
        const status = held<ProviderUser | null>();
        platform({ auth: { getLoginStatus: vi.fn(() => status.promise) } });

        const read = omni.readAccount(providerId, 'start');
        await vi.waitFor(() => expect(account()).toMatchObject({ status: 'unknown', hydration: 'loading', user: null, freshness: 'refreshing' }));
        status.answer(null);

        await expect(read).resolves.toBe('nobody');
        expect(account()).toMatchObject({ status: 'anonymous', hydration: 'ready', user: null });
        expect(account().error).toBeUndefined();
    });

    it('lets the kept account leave when the platform names nobody: the adapter is told, then the screen and the disk are cleared', async () => {
        keep({ user, collections: [list('kept')], likedSongIds: ['kept-like'] });
        const shownWhenTold: unknown[] = [];
        const signInRanOut = vi.fn(() => { shownWhenTold.push(account()?.user?.id); });
        const { auth } = platform({ auth: { getLoginStatus: vi.fn(async () => null), signInRanOut } });

        await expect(omni.readAccount(providerId, 'start')).resolves.toBe('ran out');
        expect(shownWhenTold).toEqual(['abc']);
        expect(account()).toMatchObject({ status: 'anonymous', user: null, collections: [], likedSongIds: [], error: 'auth-required' });
        expect(stored.has(snapshotKey())).toBe(false);
        expect(auth.logout).not.toHaveBeenCalled();
    });

    it('reads the platform and keeps what it read as this text', async () => {
        keep({ user, collections: [list('kept')], likedSongIds: ['kept-like'] });
        platform();

        await expect(omni.readAccount(providerId, 'start')).resolves.toBe('read');
        expect(account()).toMatchObject({ status: 'authenticated', user, collections: [{ id: 'one' }], likedSongIds: ['liked-1'], freshness: 'fresh', lastUpdatedAt: NOW });
        expect(stored.get(snapshotKey())).toBe(`{"version":1,"savedAt":${NOW},"user":{"id":"abc","nickname":"Listener"},`
            + `"collections":[{"providerId":"${providerId}","type":"playlist","id":"one","name":"one"}],"likedSongIds":["liked-1"]}`);
    });

    it('empties what was held for another user as soon as the platform names this one', async () => {
        keep({ user: { id: 'someone-else', nickname: 'Other' }, collections: [list('theirs')], likedSongIds: ['their-like'] });
        const page = held<Page>();
        platform({ library: { getUserPlaylists: vi.fn(() => page.promise), getLikedSongIds: vi.fn(async () => { throw new Error('offline'); }) } });

        const read = omni.readAccount(providerId, 'start');
        await vi.waitFor(() => expect(account()?.user).toEqual(user));
        expect(account()).toMatchObject({ collections: [], likedSongIds: [] });
        page.answer(onePage('mine'));

        await expect(read).resolves.toBe('read');
        expect(JSON.parse(stored.get(snapshotKey())!)).toMatchObject({ user: { id: 'abc' }, collections: [{ id: 'mine' }], likedSongIds: [] });
    });

    // An adapter whose builds from before the snapshot kept the account elsewhere (NetEase).
    it('where no snapshot is found, shows what an older build of the adapter kept and keeps it as this text', async () => {
        const status = held<ProviderUser | null>();
        const oldKeptAccount = vi.fn(async () => ({ user, collections: [list('old')], likedSongIds: ['old-like'] }));
        platform({ auth: { getLoginStatus: vi.fn(() => status.promise), oldKeptAccount } });

        const read = omni.readAccount(providerId, 'start');
        await vi.waitFor(() => expect(account()?.user).toEqual(user));
        expect(account()).toMatchObject({ status: 'authenticated', collections: [{ id: 'old' }], likedSongIds: ['old-like'], freshness: 'refreshing', lastUpdatedAt: NOW });
        expect(stored.get(snapshotKey())).toBe(`{"version":1,"savedAt":${NOW},"user":{"id":"abc","nickname":"Listener"},`
            + `"collections":[{"providerId":"${providerId}","type":"playlist","id":"old","name":"old"}],"likedSongIds":["old-like"]}`);
        status.refuse(new Error('offline'));

        await expect(read).resolves.toBe('unknown');
        expect(account()).toMatchObject({ status: 'authenticated', user, collections: [{ id: 'old' }], freshness: 'error' });
        expect(oldKeptAccount).toHaveBeenCalledTimes(1);
    });

    it('does not ask for what an older build kept where a snapshot is found', async () => {
        keep({ user, collections: [list('kept')] });
        const oldKeptAccount = vi.fn(async () => ({ user, collections: [list('old')], likedSongIds: [] }));
        platform({ auth: { oldKeptAccount } });

        await expect(omni.readAccount(providerId, 'start')).resolves.toBe('read');
        expect(oldKeptAccount).not.toHaveBeenCalled();
    });
});

describe.each([
    ['whose kept account waits for the platform (Bodian, YouTube Music, Spotify)', false],
    ['whose kept account shows at once (KuGou, QQ)', true],
])('the read of an account of a platform %s', (_kind, showsKept) => {
    beforeEach(() => { showsKeptAccountAtStart = showsKept; });

    const signedIn = async (collections: ProviderCollection[] = [list('held')], likedSongIds = ['held-like']) => {
        keep({ user, collections, likedSongIds });
        await omni.readAccount(providerId, 'start');
    };

    it('shows nobody and asks nothing where the platform cannot be asked here', async () => {
        const { auth } = platform({ configured: false });
        await expect(omni.readAccount(providerId, 'start')).resolves.toBe('nobody');
        expect(account()).toMatchObject({ status: 'anonymous', user: null, collections: [], error: 'runtime-unavailable' });
        expect(auth.getLoginStatus).not.toHaveBeenCalled();
    });

    // QQ names some accounts with neither an id nor a name: the user the adapter gives is the sign.
    it('takes a user without an id or a name for somebody signed in', async () => {
        const nameless: ProviderUser = { id: '', nickname: '' };
        const { library } = platform({ auth: { getLoginStatus: vi.fn(async () => nameless) } });

        await expect(omni.readAccount(providerId, 'sign-in')).resolves.toBe('read');
        expect(library.getUserPlaylists).toHaveBeenCalledWith('', 50, 0);
        expect(account()).toMatchObject({ status: 'authenticated', user: nameless, collections: [{ id: 'one' }], freshness: 'fresh' });
        expect(JSON.parse(stored.get(snapshotKey())!).user).toEqual(nameless);
        // The same user again: what is shown is kept, nothing is emptied in between.
        await expect(omni.readAccount(providerId, 'sync')).resolves.toBe('read');
        expect(account()).toMatchObject({ user: nameless, collections: [{ id: 'one' }] });
    });

    describe('one read at a time', () => {
        it('lets a switch or the sync button join the read under way: the platform is asked once', async () => {
            const status = held<ProviderUser | null>();
            const { auth, library } = platform({ auth: { getLoginStatus: vi.fn(() => status.promise) } });

            const start = omni.readAccount(providerId, 'start');
            const switched = omni.readAccount(providerId, 'switch');
            const synced = omni.readAccount(providerId, 'sync');
            status.answer(user);

            await expect(Promise.all([start, switched, synced])).resolves.toEqual(['read', 'read', 'read']);
            expect(auth.getLoginStatus).toHaveBeenCalledTimes(1);
            expect(library.getUserPlaylists).toHaveBeenCalledTimes(1);
            expect(library.getLikedSongIds).toHaveBeenCalledTimes(1);
            // The next one is a read of its own.
            await expect(omni.readAccount(providerId, 'sync')).resolves.toBe('read');
            expect(auth.getLoginStatus).toHaveBeenCalledTimes(2);
        });

        it('gives up the read under way for a completed sign-in: an answer from before the sign-in signs nobody out', async () => {
            const before = held<ProviderUser | null>();
            const getLoginStatus = vi.fn<() => Promise<ProviderUser | null>>().mockReturnValueOnce(before.promise).mockResolvedValue(user);
            const { auth } = platform({ auth: { getLoginStatus } });

            const start = omni.readAccount(providerId, 'start');
            await vi.waitFor(() => expect(getLoginStatus).toHaveBeenCalledTimes(1));
            await expect(omni.readAccount(providerId, 'sign-in')).resolves.toBe('read');
            before.answer(null);

            await expect(start).resolves.toBe('unknown');
            expect(account()).toMatchObject({ status: 'authenticated', user, collections: [{ id: 'one' }], freshness: 'fresh' });
            expect(stored.has(snapshotKey())).toBe(true);
            expect(auth.logout).not.toHaveBeenCalled();
        });

        it('reads every page of the playlists, and stops where the platform stops moving on', async () => {
            const getUserPlaylists = vi.fn()
                .mockResolvedValueOnce({ items: [list('a')], hasMore: true, nextOffset: 1 })
                .mockResolvedValueOnce({ items: [list('b')], hasMore: true, nextOffset: 1 });
            platform({ library: { getUserPlaylists } });

            await expect(omni.readAccount(providerId, 'sync')).resolves.toBe('read');
            expect(getUserPlaylists.mock.calls).toEqual([['abc', 50, 0], ['abc', 50, 1]]);
            expect(account().collections.map(collection => collection.id)).toEqual(['a', 'b']);
        });

        it('lets a moment that would read the liked songs join the read under way: they are read once', async () => {
            useOnlineProviderAccountStore.setState({ activeProviderId: providerId });
            const liked = held<ProviderLikedSongIds>();
            const { library } = platform({ library: { getLikedSongIds: vi.fn(() => liked.promise), getLikedSongCount: vi.fn(async () => 2) } });

            const read = omni.readAccount(providerId, 'sync');
            await vi.waitFor(() => expect(library.getLikedSongIds).toHaveBeenCalled());
            void omni.accountMoment('window-returned');
            await vi.waitFor(() => expect(log).toHaveBeenCalledWith(expect.stringContaining('window-returned: the liked list counts 2, 0 held: the liked songs are read whole')));
            liked.answer({ ids: ['a', 'b'], whole: true });

            await expect(read).resolves.toBe('read');
            expect(library.getLikedSongIds).toHaveBeenCalledTimes(1);
            expect(account().likedSongIds).toEqual(['a', 'b']);
        });

        // The platform may name another user without a sign-in made in Folia (a sign-in held outside this page).
        it('shows and keeps nothing of the playlists read alone for one user once the platform has named another', async () => {
            const other: ProviderUser = { id: 'other', nickname: 'Other' };
            const late = held<Page>();
            const getLoginStatus = vi.fn<() => Promise<ProviderUser | null>>().mockResolvedValueOnce(user).mockResolvedValue(other);
            const getUserPlaylists = vi.fn(async (userId: unknown): Promise<Page> => onePage(`of-${userId}`));
            platform({ auth: { getLoginStatus }, library: { getUserPlaylists } });
            await omni.readAccount(providerId, 'sync');
            getUserPlaylists.mockReturnValueOnce(late.promise);

            const alone = omni.refreshProviderPlaylists(providerId);
            await expect(omni.readAccount(providerId, 'sync')).resolves.toBe('read');
            expect(account()).toMatchObject({ user: other, collections: [{ id: 'of-other' }] });
            const text = stored.get(snapshotKey());
            late.answer(onePage('of-abc-late'));

            await expect(alone).resolves.toEqual([list('of-abc-late')]);
            expect(account()).toMatchObject({ user: other, collections: [{ id: 'of-other' }], freshness: 'fresh' });
            expect(stored.get(snapshotKey())).toBe(text);
        });
    });

    describe('the cloud entry', () => {
        const cloud: ProviderCollection = { providerId: 'x', id: 'cloud', type: 'cloud', name: 'Cloud' };

        it('stands with the playlists and is kept with them; one the platform no longer has goes', async () => {
            const getCloudCollection = vi.fn<NonNullable<OnlineLibraryProvider['getCloudCollection']>>().mockResolvedValueOnce(cloud).mockResolvedValue(null);
            platform({ library: { getCloudCollection } });

            await expect(omni.readAccount(providerId, 'sync')).resolves.toBe('read');
            expect(getCloudCollection).toHaveBeenCalledWith(user);
            expect(account().collections.map(collection => collection.id)).toEqual(['one', 'cloud']);
            expect(JSON.parse(stored.get(snapshotKey())!).collections.map((collection: ProviderCollection) => collection.id)).toEqual(['one', 'cloud']);

            await expect(omni.readAccount(providerId, 'sync')).resolves.toBe('read');
            expect(account().collections.map(collection => collection.id)).toEqual(['one']);
        });

        it('stays as it is held when it cannot be read', async () => {
            const getCloudCollection = vi.fn<NonNullable<OnlineLibraryProvider['getCloudCollection']>>().mockResolvedValueOnce(cloud).mockRejectedValue(new Error('offline'));
            platform({ library: { getCloudCollection } });
            await omni.readAccount(providerId, 'sync');

            await expect(omni.readAccount(providerId, 'sync')).resolves.toBe('read');
            expect(account().collections.map(collection => collection.id)).toEqual(['one', 'cloud']);
            expect(warn).toHaveBeenCalledWith(`[Account] ${providerId}: sync: the cloud entry could not be read, the one held stays: offline`);
        });
    });

    describe('a read crossing a press', () => {
        it.each([true, false])('keeps like=%s pressed while the liked songs were being read, on the screen and on disk', async liked => {
            const before = liked ? [] : ['pressed'];
            keep({ user, likedSongIds: before });
            const answer = held<ProviderLikedSongIds>();
            const { library } = platform({ library: { getLikedSongIds: vi.fn(() => answer.promise) } });

            const read = omni.readAccount(providerId, 'start');
            await vi.waitFor(() => expect(library.getLikedSongIds).toHaveBeenCalled());
            await omni.likeSong(song('pressed'), liked);
            answer.answer({ ids: before, whole: true });

            await expect(read).resolves.toBe('read');
            expect(omni.isSongLiked(song('pressed'))).toBe(liked);
            expect(JSON.parse(stored.get(snapshotKey())!).likedSongIds).toEqual(liked ? ['pressed'] : []);
        });

        it.each([true, false])('keeps like=%s pressed while the account was being saved, on the screen and on disk', async liked => {
            const before = liked ? [] : ['pressed'];
            keep({ user, likedSongIds: before });
            platform({ library: { getLikedSongIds: vi.fn(async () => ({ ids: before, whole: true })) } });
            const saving = held<void>();
            disk.held = saving.promise;

            const read = omni.readAccount(providerId, 'start');
            await vi.waitFor(() => expect(disk.asked).toBe(1), { interval: 1 });
            const pressed = omni.likeSong(song('pressed'), liked);
            // The press saves the account too, behind the save of the read.
            await vi.waitFor(() => expect(disk.asked).toBe(2), { interval: 1 });
            saving.answer();
            await pressed;

            await expect(read).resolves.toBe('read');
            expect(omni.isSongLiked(song('pressed'))).toBe(liked);
            expect(JSON.parse(stored.get(snapshotKey())!).likedSongIds).toEqual(liked ? ['pressed'] : []);
        });

        it('takes what the platform read for a song nobody pressed', async () => {
            platform({ library: { getLikedSongIds: vi.fn(async () => ({ ids: ['elsewhere'], whole: true })) } });
            await expect(omni.readAccount(providerId, 'sync')).resolves.toBe('read');
            expect(omni.isSongLiked(song('elsewhere'))).toBe(true);
            expect(JSON.parse(stored.get(snapshotKey())!).likedSongIds).toEqual(['elsewhere']);
        });

        // A heart pressed for one user says nothing of another user's liked songs.
        it.each([true, false])('lets another user, named right after like=%s was pressed for the one shown, take their own liked songs', async liked => {
            const other: ProviderUser = { id: 'other', nickname: 'Other' };
            let who = user;
            platform({ auth: { getLoginStatus: vi.fn(async () => who) }, library: { getLikedSongIds: vi.fn(async (userId: unknown) => ({
                ids: String(userId) === 'other' ? ['pressed', 'theirs'] : (liked ? [] : ['pressed']),
                whole: true,
            })) } });
            await expect(omni.readAccount(providerId, 'sync')).resolves.toBe('read');
            await omni.likeSong(song('pressed'), liked);

            who = other;
            await expect(omni.readAccount(providerId, 'switch')).resolves.toBe('read');

            expect(account().user).toEqual(other);
            expect(omni.isSongLiked(song('pressed'))).toBe(true);
            expect(JSON.parse(stored.get(snapshotKey())!).likedSongIds).toEqual(['pressed', 'theirs']);
        });

        it('lets another user, named while a like pressed for the one shown is unanswered, take their own liked songs; the late answer writes nothing', async () => {
            const other: ProviderUser = { id: 'other', nickname: 'Other' };
            let who = user;
            const request = held<void>();
            platform({
                auth: { getLoginStatus: vi.fn(async () => who) },
                library: { getLikedSongIds: vi.fn(async () => ({ ids: ['pressed'], whole: true })) },
                mutations: { likeSong: vi.fn(() => request.promise) },
            });
            await expect(omni.readAccount(providerId, 'sync')).resolves.toBe('read');
            const press = omni.pressSongLike(song('pressed'), false);
            expect(omni.isSongLiked(song('pressed'))).toBe(false);

            who = other;
            await expect(omni.readAccount(providerId, 'switch')).resolves.toBe('read');
            expect(omni.isSongLiked(song('pressed'))).toBe(true);

            request.answer();
            await expect(press.settled).resolves.toEqual({ ok: true, liked: false });
            expect(omni.isSongLiked(song('pressed'))).toBe(true);
            expect(account().likedSongIds).toEqual(['pressed']);
        });

        it('lets another user, signed in after a sign-out while a like pressed for the one before is unanswered, take their own liked songs; the late answer writes nothing', async () => {
            const other: ProviderUser = { id: 'other', nickname: 'Other' };
            let who = user;
            const request = held<void>();
            platform({
                auth: { getLoginStatus: vi.fn(async () => who) },
                library: { getLikedSongIds: vi.fn(async () => ({ ids: ['pressed'], whole: true })) },
                mutations: { likeSong: vi.fn(() => request.promise) },
            });
            await expect(omni.readAccount(providerId, 'sync')).resolves.toBe('read');
            const press = omni.pressSongLike(song('pressed'), false);
            await omni.signOutAccount(providerId);

            who = other;
            await expect(omni.readAccount(providerId, 'sign-in')).resolves.toBe('read');
            expect(omni.isSongLiked(song('pressed'))).toBe(true);

            request.answer();
            await press.settled;
            expect(omni.isSongLiked(song('pressed'))).toBe(true);
            expect(account().likedSongIds).toEqual(['pressed']);
        });
    });

    describe('the liked songs read whole', () => {
        const keptLikes = () => [...JSON.parse(stored.get(snapshotKey())!).likedSongIds].sort();

        it('replace the liked ids the account holds', async () => {
            keep({ user, likedSongIds: ['stays', 'left-elsewhere'] });
            platform({ library: { getLikedSongIds: vi.fn(async () => ({ ids: ['stays', 'liked-elsewhere'], whole: true })) } });

            await expect(omni.readAccount(providerId, 'start')).resolves.toBe('read');
            expect([...account().likedSongIds].sort()).toEqual(['liked-elsewhere', 'stays']);
            expect(omni.isSongLiked(song('left-elsewhere'))).toBe(false);
            expect(keptLikes()).toEqual(['liked-elsewhere', 'stays']);
        });

        it('change nothing where they are empty while liked ids are held', async () => {
            keep({ user, likedSongIds: ['held', 'held-too'] });
            platform({ library: { getLikedSongIds: vi.fn(async () => ({ ids: [], whole: true })) } });

            await expect(omni.readAccount(providerId, 'start')).resolves.toBe('read');
            expect([...account().likedSongIds].sort()).toEqual(['held', 'held-too']);
            expect(keptLikes()).toEqual(['held', 'held-too']);
        });
    });

    describe('a read failing', () => {
        it('keeps the account as shown when who is signed in cannot be asked', async () => {
            const getLoginStatus = vi.fn<() => Promise<ProviderUser | null>>().mockResolvedValueOnce(user).mockRejectedValue(new Error('offline'));
            const { library } = platform({ auth: { getLoginStatus } });
            await signedIn();
            const text = stored.get(snapshotKey());

            await expect(omni.readAccount(providerId, 'sync')).resolves.toBe('unknown');
            expect(account()).toMatchObject({ status: 'authenticated', user, collections: [{ id: 'one' }], likedSongIds: ['liked-1'], freshness: 'error', error: 'offline' });
            expect(library.getUserPlaylists).toHaveBeenCalledTimes(1);
            expect(stored.get(snapshotKey())).toBe(text);
        });

        it('ends after a minute without an answer to who is signed in: the account stays, the next read asks anew, the late answer signs nobody out', async () => {
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
            try {
                const never = held<ProviderUser | null>();
                const getLoginStatus = vi.fn<() => Promise<ProviderUser | null>>().mockResolvedValueOnce(user).mockReturnValueOnce(never.promise).mockResolvedValue(user);
                platform({ auth: { getLoginStatus } });
                await signedIn();
                const text = stored.get(snapshotKey());

                const synced = omni.readAccount(providerId, 'sync');
                const switched = omni.readAccount(providerId, 'switch');
                await vi.advanceTimersByTimeAsync(59_999);
                expect(account()).toMatchObject({ user, freshness: 'refreshing' });
                await vi.advanceTimersByTimeAsync(1);

                await expect(Promise.all([synced, switched])).resolves.toEqual(['unknown', 'unknown']);
                expect(account()).toMatchObject({ status: 'authenticated', user, collections: [{ id: 'one' }], freshness: 'error', error: 'no answer in 60 s' });
                expect(stored.get(snapshotKey())).toBe(text);

                await expect(omni.readAccount(providerId, 'sync')).resolves.toBe('read');
                expect(getLoginStatus).toHaveBeenCalledTimes(3);
                never.answer(null);
                await vi.advanceTimersByTimeAsync(0);
                expect(account()).toMatchObject({ status: 'authenticated', user, freshness: 'fresh' });
                expect(account().error).toBeUndefined();
                expect(stored.has(snapshotKey())).toBe(true);
            } finally {
                vi.useRealTimers();
            }
        });

        it('keeps the account and the hearts, and does not read the liked songs, when the playlists cannot be read', async () => {
            const getUserPlaylists = vi.fn().mockResolvedValueOnce(onePage('one')).mockRejectedValue(new Error('network'));
            const { auth, library } = platform({ library: { getUserPlaylists } });
            await signedIn();
            const text = stored.get(snapshotKey());

            await expect(omni.readAccount(providerId, 'sync')).resolves.toBe('not read');
            expect(account()).toMatchObject({ status: 'authenticated', user, collections: [{ id: 'one' }], likedSongIds: ['liked-1'], freshness: 'error', error: 'network' });
            expect(library.getLikedSongIds).toHaveBeenCalledTimes(1);
            expect(auth.getLoginStatus).toHaveBeenCalledTimes(2);
            expect(stored.get(snapshotKey())).toBe(text);
            expect(warn).toHaveBeenCalledWith(`[Account] ${providerId}: sync: the account could not be read, it stays as it is shown: network`);
        });

        it('keeps the hearts as they were, shows the playlists and saves both, when the liked songs cannot be read', async () => {
            keep({ user, likedSongIds: ['held-like'] });
            platform({ library: { getLikedSongIds: vi.fn(async () => { throw new Error('offline'); }) } });

            await expect(omni.readAccount(providerId, 'start')).resolves.toBe('read');
            expect(account()).toMatchObject({ collections: [{ id: 'one' }], likedSongIds: ['held-like'], freshness: 'fresh' });
            expect(JSON.parse(stored.get(snapshotKey())!)).toMatchObject({ collections: [{ id: 'one' }], likedSongIds: ['held-like'] });
            expect(warn).toHaveBeenCalledExactlyOnceWith(`[Account] ${providerId}: start: the liked songs could not be read, the hearts stay as they were: offline`);
        });

        it('lets the account leave when the playlists are refused for the sign-in and the platform then names nobody', async () => {
            const getLoginStatus = vi.fn<() => Promise<ProviderUser | null>>().mockResolvedValueOnce(user).mockResolvedValueOnce(user).mockResolvedValue(null);
            const getUserPlaylists = vi.fn().mockResolvedValueOnce(onePage('one')).mockRejectedValue(refused());
            // The adapter is told while the account is still shown: what shows it asks the adapter again as the store changes.
            const shownWhenTold: unknown[] = [];
            const signInRanOut = vi.fn(() => { shownWhenTold.push(account()?.user); });
            const { auth } = platform({ auth: { getLoginStatus, signInRanOut }, library: { getUserPlaylists } });
            await signedIn();

            await expect(omni.readAccount(providerId, 'sync')).resolves.toBe('ran out');
            expect(shownWhenTold).toEqual([user]);
            expect(account()).toMatchObject({ status: 'anonymous', user: null, collections: [], likedSongIds: [], error: 'auth-required' });
            expect(stored.has(snapshotKey())).toBe(false);
            expect(auth.logout).not.toHaveBeenCalled();
            expect(log).toHaveBeenCalledWith(`[Account] ${providerId}: sync: the sign-in is no longer valid, the account left`);
        });

        it('signs nobody out for a refused playlist read while the platform still names the user', async () => {
            const getUserPlaylists = vi.fn().mockResolvedValueOnce(onePage('one')).mockRejectedValue(refused());
            const { auth } = platform({ library: { getUserPlaylists } });
            await signedIn();

            await expect(omni.readAccount(providerId, 'sync')).resolves.toBe('not read');
            expect(auth.getLoginStatus).toHaveBeenCalledTimes(3);
            expect(account()).toMatchObject({ status: 'authenticated', user, collections: [{ id: 'one' }], freshness: 'error', error: 'refused' });
            expect(stored.has(snapshotKey())).toBe(true);
        });

        it('says the sign-in ran out when the platform names nobody for an account that was shown', async () => {
            const getLoginStatus = vi.fn<() => Promise<ProviderUser | null>>().mockResolvedValueOnce(user).mockResolvedValue(null);
            platform({ auth: { getLoginStatus } });
            await signedIn();

            await expect(omni.readAccount(providerId, 'sync')).resolves.toBe('ran out');
            expect(account()).toMatchObject({ status: 'anonymous', user: null, error: 'auth-required' });
            expect(stored.has(snapshotKey())).toBe(false);
        });
    });

    describe('a sign-out', () => {
        it('tells the adapter before the account leaves the screen, and takes the kept account away', async () => {
            const shownWhenTold: unknown[] = [];
            const { auth } = platform({ auth: { logout: vi.fn(async () => { shownWhenTold.push(account()?.user); }) } });
            await omni.readAccount(providerId, 'sync');
            expect(stored.has(snapshotKey())).toBe(true);

            await omni.signOutAccount(providerId);
            expect(auth.logout).toHaveBeenCalledTimes(1);
            expect(shownWhenTold).toEqual([user]);
            expect(account()).toMatchObject({ status: 'anonymous', user: null, collections: [], likedSongIds: [] });
            expect(account().error).toBeUndefined();
            expect(stored.has(snapshotKey())).toBe(false);
        });

        it('takes the account off the screen at once and ends well when the platform cannot be told', async () => {
            const leaving = held<void>();
            platform({ auth: { logout: vi.fn(() => leaving.promise) } });
            await omni.readAccount(providerId, 'sync');

            const signedOut = omni.signOutAccount(providerId);
            expect(account()).toMatchObject({ status: 'anonymous', user: null });
            leaving.refuse(new Error('offline'));
            await expect(signedOut).resolves.toBeUndefined();
            expect(stored.has(snapshotKey())).toBe(false);
        });

        it.each(['who is signed in', 'the playlists', 'the liked songs'])('in the middle of a read, while %s is asked: the late answer shows and keeps nothing', async part => {
            const status = held<ProviderUser | null>();
            const page = held<Page>();
            const liked = held<ProviderLikedSongIds>();
            if (part !== 'who is signed in') status.answer(user);
            if (part === 'the liked songs') page.answer(onePage('late'));
            const { auth, library } = platform({
                auth: { getLoginStatus: vi.fn(() => status.promise) },
                library: { getUserPlaylists: vi.fn(() => page.promise), getLikedSongIds: vi.fn(() => liked.promise) },
            });
            const asked = part === 'who is signed in' ? auth.getLoginStatus : part === 'the playlists' ? library.getUserPlaylists : library.getLikedSongIds;

            const read = omni.readAccount(providerId, 'sync');
            await vi.waitFor(() => expect(asked).toHaveBeenCalled());
            await omni.signOutAccount(providerId);
            status.answer(user);
            page.answer(onePage('late'));
            liked.answer({ ids: ['late-like'], whole: true });

            await expect(read).resolves.toBe('unknown');
            expect(account()).toMatchObject({ status: 'anonymous', user: null, collections: [], likedSongIds: [] });
            expect(stored.has(snapshotKey())).toBe(false);
        });

        it('in the middle of a read of the playlists alone: the late answer shows and keeps nothing', async () => {
            const page = held<Page>();
            const getUserPlaylists = vi.fn().mockResolvedValueOnce(onePage('one')).mockReturnValue(page.promise);
            platform({ library: { getUserPlaylists } });
            await omni.readAccount(providerId, 'sync');

            const refreshed = omni.refreshProviderPlaylists(providerId);
            await omni.signOutAccount(providerId);
            page.answer(onePage('late'));

            await expect(refreshed).resolves.toEqual([list('late')]);
            expect(account()).toMatchObject({ status: 'anonymous', user: null, collections: [] });
            expect(stored.has(snapshotKey())).toBe(false);
        });
    });

    describe('the home screen entered', () => {
        // The clock the reads measure their waits by.
        let clock = 0;
        beforeEach(() => {
            clock = 1_000_000;
            vi.spyOn(performance, 'now').mockImplementation(() => clock);
            useOnlineProviderAccountStore.setState({ activeProviderId: providerId });
        });

        it('reads the playlists of the account shown again, at most once in five seconds', async () => {
            const getUserPlaylists = vi.fn(async (): Promise<Page> => onePage('one'));
            const { auth, library } = platform({ library: { getUserPlaylists } });
            await omni.readAccount(providerId, 'sync');
            expect(getUserPlaylists).toHaveBeenCalledTimes(1);

            // The account was read a moment ago.
            await expect(omni.accountMoment('home-entered')).resolves.toBe('not asked');
            clock += 5_001;
            getUserPlaylists.mockResolvedValue(onePage('one', 'made-elsewhere'));
            await expect(omni.accountMoment('home-entered')).resolves.toBe('read');
            expect(account().collections.map(collection => collection.id)).toEqual(['one', 'made-elsewhere']);
            expect(JSON.parse(stored.get(snapshotKey())!).collections).toHaveLength(2);
            clock += 4_000;
            await expect(omni.accountMoment('home-entered')).resolves.toBe('not asked');

            expect(getUserPlaylists).toHaveBeenCalledTimes(2);
            expect(auth.getLoginStatus).toHaveBeenCalledTimes(1);
            expect(library.getLikedSongIds).toHaveBeenCalledTimes(1);
        });

        it('reads nothing while the account is being read, or while nobody is signed in', async () => {
            const page = held<Page>();
            const { library } = platform({ library: { getUserPlaylists: vi.fn(() => page.promise) } });
            await expect(omni.accountMoment('home-entered')).resolves.toBe('not asked');

            const read = omni.readAccount(providerId, 'sync');
            await vi.waitFor(() => expect(library.getUserPlaylists).toHaveBeenCalledTimes(1));
            clock += 60_000;
            await expect(omni.accountMoment('home-entered')).resolves.toBe('not asked');
            page.answer(onePage('one'));
            await read;
            expect(library.getUserPlaylists).toHaveBeenCalledTimes(1);
        });

        it('keeps the playlists as shown when they cannot be read, and reads again at the next entry', async () => {
            const getUserPlaylists = vi.fn(async (): Promise<Page> => onePage('one'));
            platform({ library: { getUserPlaylists } });
            await omni.readAccount(providerId, 'sync');
            clock += 5_001;
            getUserPlaylists.mockRejectedValueOnce(new Error('network'));

            await expect(omni.accountMoment('home-entered')).resolves.toBe('not read');
            expect(account()).toMatchObject({ status: 'authenticated', user, collections: [{ id: 'one' }], freshness: 'error', error: 'network' });
            await expect(omni.accountMoment('home-entered')).resolves.toBe('read');
            expect(account()).toMatchObject({ freshness: 'fresh' });
            expect(account().error).toBeUndefined();
        });

        it('lets the account leave when the playlists are refused for the sign-in and the platform names nobody', async () => {
            const getLoginStatus = vi.fn<() => Promise<ProviderUser | null>>().mockResolvedValueOnce(user).mockResolvedValue(null);
            const getUserPlaylists = vi.fn(async (): Promise<Page> => onePage('one'));
            platform({ auth: { getLoginStatus }, library: { getUserPlaylists } });
            await omni.readAccount(providerId, 'sync');
            clock += 5_001;
            getUserPlaylists.mockRejectedValue(refused());

            await expect(omni.accountMoment('home-entered')).resolves.toBe('ran out');
            expect(account()).toMatchObject({ status: 'anonymous', user: null, collections: [], error: 'auth-required' });
            expect(stored.has(snapshotKey())).toBe(false);
        });

        it('signs nobody out for a refused read while the platform still names the user', async () => {
            const getUserPlaylists = vi.fn(async (): Promise<Page> => onePage('one'));
            const { auth } = platform({ library: { getUserPlaylists } });
            await omni.readAccount(providerId, 'sync');
            clock += 5_001;
            getUserPlaylists.mockRejectedValue(refused());

            await expect(omni.accountMoment('home-entered')).resolves.toBe('not read');
            expect(auth.getLoginStatus).toHaveBeenCalledTimes(2);
            expect(account()).toMatchObject({ status: 'authenticated', user, collections: [{ id: 'one' }] });
            expect(stored.has(snapshotKey())).toBe(true);
        });

        // Nothing was kept on disk, and the platform could not be asked at app start: nobody is shown,
        // though the sign-in may still be good.
        it('reads the account whole where nobody is shown because who is signed in could not be asked: once, whatever the entries meanwhile', async () => {
            const status = held<ProviderUser | null>();
            const getLoginStatus = vi.fn<() => Promise<ProviderUser | null>>().mockRejectedValueOnce(new Error('offline')).mockReturnValueOnce(status.promise);
            platform({ auth: { getLoginStatus } });
            await expect(omni.readAccount(providerId, 'start')).resolves.toBe('unknown');
            expect(account()).toMatchObject({ user: null, freshness: 'error', error: 'offline' });
            clock += 5_001;

            const entered = omni.accountMoment('home-entered');
            const again = omni.accountMoment('home-entered');
            status.answer(user);

            await expect(Promise.all([entered, again])).resolves.toEqual(['read', 'read']);
            expect(getLoginStatus).toHaveBeenCalledTimes(2);
            expect(account()).toMatchObject({ status: 'authenticated', user, collections: [{ id: 'one' }], freshness: 'fresh' });
        });

        it('asks nothing again within HOME_WAIT_MS of the last time who is signed in could not be asked', async () => {
            const getLoginStatus = vi.fn<() => Promise<ProviderUser | null>>().mockRejectedValue(new Error('offline'));
            platform({ auth: { getLoginStatus } });
            await expect(omni.readAccount(providerId, 'start')).resolves.toBe('unknown');

            clock += 4_000;
            await expect(omni.accountMoment('home-entered')).resolves.toBe('not asked');
            expect(getLoginStatus).toHaveBeenCalledTimes(1);

            clock += 1_001;
            await expect(omni.accountMoment('home-entered')).resolves.toBe('unknown');
            expect(getLoginStatus).toHaveBeenCalledTimes(2);
        });

        // A platform that cannot answer for the whole run (a sign-in stored that this run cannot unseal) is not
        // asked at every entry: the wait doubles with each time in a row, up to a minute.
        it('waits twice as long after each time in a row who is signed in could not be asked, up to a minute', async () => {
            const getLoginStatus = vi.fn<() => Promise<ProviderUser | null>>().mockRejectedValue(new Error('unreadable'));
            platform({ auth: { getLoginStatus } });
            await expect(omni.readAccount(providerId, 'start')).resolves.toBe('unknown');

            const asksAfter = async (wait: number) => {
                const before = getLoginStatus.mock.calls.length;
                clock += wait - 1;
                await expect(omni.accountMoment('home-entered')).resolves.toBe('not asked');
                clock += 2;
                await expect(omni.accountMoment('home-entered')).resolves.toBe('unknown');
                expect(getLoginStatus).toHaveBeenCalledTimes(before + 1);
            };
            await asksAfter(5_000);
            await asksAfter(10_000);
            await asksAfter(20_000);
            await asksAfter(40_000);
            await asksAfter(60_000);
            await asksAfter(60_000);
        });

        it('asks nothing at the next entry where the platform named nobody', async () => {
            const { auth } = platform({ auth: { getLoginStatus: vi.fn(async () => null) } });
            await expect(omni.readAccount(providerId, 'start')).resolves.toBe('nobody');
            clock += 60_000;

            await expect(omni.accountMoment('home-entered')).resolves.toBe('not asked');
            expect(auth.getLoginStatus).toHaveBeenCalledTimes(1);
        });
    });
});
