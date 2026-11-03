import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { omni } from '@/services/onlineMusic/omni';
import { registerOnlineMusicProvider, unregisterOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import type { UnifiedSong } from '@/types';
import type { OnlineMusicProvider, ProviderCollection } from '@/types/onlineMusic';

// test/unit/onlineMusic/omniLikePresses.test.ts
// The heart through omni: it answers at once and the account's liked ids follow the provider's
// answer; and the liked ids follow the account's liked list once that list is read whole.

vi.mock('@/services/onlineMusic/providerAccountCache', async importOriginal => ({
    ...(await importOriginal<typeof import('@/services/onlineMusic/providerAccountCache')>()),
    saveProviderAccountSnapshot: vi.fn(async () => ({
        version: 1 as const,
        savedAt: 1,
        user: { id: 'user', nickname: 'Listener' },
        collections: [],
        likedSongIds: [],
    })),
}));

const providerId = 'omni-like-press-test';

const song = (mediaId: string): UnifiedSong => ({
    id: mediaId,
    name: mediaId,
    artists: [],
    album: { id: '', name: '' },
    durationMs: 1,
    sourceRef: { kind: 'online', providerId, mediaId },
});

const likedList: ProviderCollection = { providerId, id: 'liked', type: 'playlist', name: 'Liked', isLiked: true, isOwned: true };

// A provider whose answers to like requests the test gives one by one.
const registerProvider = () => {
    const requests: Array<{ id: string; liked: boolean; take: () => void; refuse: (error: unknown) => void }> = [];
    const provider: OnlineMusicProvider = {
        id: providerId,
        displayName: providerId,
        capabilities: {
            search: false, playback: true, lyrics: false, auth: true, userLibrary: true,
            playlists: true, albums: false, artists: false, recommendations: false,
            mutations: true, likes: true, wordByWordLyrics: false,
        },
        normalizeSong: raw => song(String((raw as { id?: string }).id)),
        mutations: {
            likeSong: (target, liked) => new Promise<void>((take, refuse) => {
                requests.push({ id: String((target as UnifiedSong).id), liked, take, refuse });
            }),
        },
    };
    registerOnlineMusicProvider(provider);
    return requests;
};

const account = () => useOnlineProviderAccountStore.getState().accounts[providerId];
const likedIds = () => account().likedSongIds.map(String).sort();
const signIn = (likedSongIds: string[]) => {
    useOnlineProviderAccountStore.getState().updateAccount(providerId, {
        status: 'authenticated',
        user: { id: 'user', nickname: 'Listener' },
        collections: [likedList],
        likedSongIds,
    });
};

describe('omni like presses', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.useRealTimers();
        unregisterOnlineMusicProvider(providerId);
        useOnlineProviderAccountStore.getState().clearAccount(providerId);
    });

    it('shows the heart at once, and writes the liked ids once the provider took the request', async () => {
        const requests = registerProvider();
        signIn(['held']);
        const target = song('at-once');

        const press = omni.pressSongLike(target);

        expect(press.wanted).toBe(true);
        expect(omni.isSongLiked(target)).toBe(true);
        expect(likedIds()).toEqual(['held']);
        expect(requests).toMatchObject([{ id: 'at-once', liked: true }]);

        requests[0].take();
        await expect(press.settled).resolves.toEqual({ ok: true, liked: true });
        expect(likedIds()).toEqual(['at-once', 'held']);
        expect(account().wantedLikes).toEqual({});
        expect(omni.isSongLiked(target)).toBe(true);
    });

    it('sends quick presses one request at a time and leaves the provider with the last state asked for', async () => {
        const requests = registerProvider();
        signIn([]);
        const target = song('quick');

        const first = omni.pressSongLike(target);
        const second = omni.pressSongLike(target);

        expect(second).toMatchObject({ wanted: false, joined: true });
        expect(omni.isSongLiked(target)).toBe(false);
        expect(requests).toHaveLength(1);

        requests[0].take();
        await vi.waitFor(() => expect(requests).toHaveLength(2));
        expect(requests[1]).toMatchObject({ id: 'quick', liked: false });
        // The first request was taken: the account holds the like, the heart shows what was asked for.
        expect(likedIds()).toEqual(['quick']);
        expect(omni.isSongLiked(target)).toBe(false);

        requests[1].take();
        await expect(first.settled).resolves.toEqual({ ok: true, liked: false });
        expect(likedIds()).toEqual([]);
        expect(omni.isSongLiked(target)).toBe(false);
    });

    it('puts the heart back to what the account holds when the request fails', async () => {
        const requests = registerProvider();
        signIn(['held']);
        const target = song('held');

        const press = omni.pressSongLike(target);
        expect(omni.isSongLiked(target)).toBe(false);

        const error = new Error('offline');
        requests[0].refuse(error);
        await expect(press.settled).resolves.toEqual({ ok: false, error });
        expect(omni.isSongLiked(target)).toBe(true);
        expect(likedIds()).toEqual(['held']);
        expect(account().wantedLikes).toEqual({});
    });

    it('replaces the liked ids with a liked list read whole, and logs the read in one line of counts', () => {
        registerProvider();
        signIn(['stays', 'left-elsewhere']);

        const read = omni.beginLikedListRead(likedList);
        expect(read).not.toBeNull();
        omni.endLikedListRead(read!, [song('stays'), song('liked-elsewhere')], true);

        expect(likedIds()).toEqual(['liked-elsewhere', 'stays']);
        expect(omni.isSongLiked(song('left-elsewhere'))).toBe(false);
        expect(console.log).toHaveBeenLastCalledWith(`[Like] ${providerId}: liked songs read (whole, 2 ids) applied: 1 added, 1 removed, 0 kept because pressed`);
    });

    it('drops a read of the liked ids when one begun after it was applied before it', () => {
        registerProvider();
        signIn(['held-before-both']);

        const older = omni.beginLikedListRead(likedList)!;
        const newer = omni.beginLikedListRead(likedList)!;
        omni.endLikedListRead(newer, ['of-the-newer-read'].map(song), true);
        omni.endLikedListRead(older, [song('of-the-older-read')], true);

        expect(likedIds()).toEqual(['of-the-newer-read']);
    });

    it('applies a read although one begun after it never ended', () => {
        registerProvider();
        signIn(['held-before-both']);

        const older = omni.beginLikedListRead(likedList)!;
        omni.beginLikedListRead(likedList);
        omni.endLikedListRead(older, ['of-the-older-read'].map(song), true);

        expect(likedIds()).toEqual(['of-the-older-read']);
    });

    it('applies a whole read although a read begun after it, which was not whole, was applied before it', () => {
        registerProvider();
        signIn(['left-elsewhere', 'stays']);

        const older = omni.beginLikedListRead(likedList)!;
        const newer = omni.beginLikedListRead(likedList)!;
        omni.endLikedListRead(newer, [song('stays')], false);
        omni.endLikedListRead(older, ['stays'].map(song), true);

        expect(likedIds()).toEqual(['stays']);
    });

    it('takes a read for a song whose request failed: the heart follows the provider', async () => {
        const requests = registerProvider();
        signIn(['held']);
        const read = omni.beginLikedListRead(likedList)!;

        const press = omni.pressSongLike(song('liked-elsewhere'), true);
        requests[0].refuse(new Error('refused'));
        await press.settled;
        omni.endLikedListRead(read, ['held', 'liked-elsewhere'].map(song), true);

        expect(likedIds()).toEqual(['held', 'liked-elsewhere']);
    });

    it('writes a like sent before the account was named into the account named when it is answered', async () => {
        const requests = registerProvider();

        const press = omni.pressSongLike(song('pressed-at-start'), true);
        signIn(['held']);
        requests[0].take();

        expect(await press.settled).toEqual({ ok: true, liked: true });
        expect(likedIds()).toEqual(['held', 'pressed-at-start']);
    });

    it('puts the heart back after 20 seconds without an answer, and writes nothing when the answer comes late', async () => {
        vi.useFakeTimers();
        const requests = registerProvider();
        signIn(['held']);
        const target = song('never-answered');

        const press = omni.pressSongLike(target);
        expect(omni.isSongLiked(target)).toBe(true);
        await vi.advanceTimersByTimeAsync(20_000);

        await expect(press.settled).resolves.toMatchObject({ ok: false });
        expect(omni.isSongLiked(target)).toBe(false);

        requests[0].take();
        await vi.advanceTimersByTimeAsync(0);
        expect(likedIds()).toEqual(['held']);
    });

    it.each(['the listener signed out', 'another account signed in'])('writes nothing into the account when a request is answered after %s', async change => {
        const requests = registerProvider();
        signIn(['of-the-first-account']);

        const press = omni.pressSongLike(song('liked-under-the-first-account'));
        if (change === 'the listener signed out') useOnlineProviderAccountStore.getState().clearAccount(providerId);
        else useOnlineProviderAccountStore.getState().updateAccount(providerId, { user: { id: 'other-user', nickname: 'Other' }, likedSongIds: ['of-the-second-account'] });
        requests[0].take();
        await press.settled;

        expect(likedIds()).toEqual(change === 'the listener signed out' ? [] : ['of-the-second-account']);
    });

    it('changes nothing for a liked list read whole that has no song while liked ids are held', () => {
        registerProvider();
        signIn(['held', 'held-too']);
        const before = account().likedSongIds;

        omni.endLikedListRead(omni.beginLikedListRead(likedList)!, [], true);

        expect(account().likedSongIds).toBe(before);
    });

    it('rejects a like that was waited for when a heart pressed meanwhile left the other state', async () => {
        const requests = registerProvider();
        signIn(['removed-then-liked']);
        const target = song('removed-then-liked');

        const removal = omni.likeSong(target, false);
        const failed = expect(removal).rejects.toThrow('pressed again meanwhile');
        omni.pressSongLike(target, true);
        requests[0].take();
        await vi.waitFor(() => expect(requests).toHaveLength(2));
        requests[1].take();

        await failed;
        expect(requests.map(request => request.liked)).toEqual([false, true]);
        expect(likedIds()).toEqual(['removed-then-liked']);
    });

    it('only adds from a liked list read in part, and changes nothing where the part brings nothing new', () => {
        registerProvider();
        signIn(['stays', 'beyond-the-part-read']);
        const before = account().likedSongIds;

        omni.endLikedListRead(omni.beginLikedListRead(likedList)!, [song('stays')], false);
        expect(account().likedSongIds).toBe(before);

        omni.endLikedListRead(omni.beginLikedListRead(likedList)!, [song('stays'), song('liked-elsewhere')], false);
        expect(likedIds()).toEqual(['beyond-the-part-read', 'liked-elsewhere', 'stays']);
    });

    it('does not let a whole read overwrite a heart whose request is not settled', async () => {
        const requests = registerProvider();
        signIn(['stays']);
        const pressed = song('pressed');

        const read = omni.beginLikedListRead(likedList)!;
        const press = omni.pressSongLike(pressed);
        // The list was read before the request reached the provider: the song is not in it.
        omni.endLikedListRead(read, [song('stays')], true);

        expect(omni.isSongLiked(pressed)).toBe(true);
        expect(likedIds()).toEqual(['stays']);

        requests[0].take();
        await press.settled;
        expect(likedIds()).toEqual(['pressed', 'stays']);
        expect(omni.isSongLiked(pressed)).toBe(true);
    });

    it('keeps what a request settled during the read left, both ways', async () => {
        const requests = registerProvider();
        signIn(['stays', 'unliked-here']);

        const read = omni.beginLikedListRead(likedList)!;
        const like = omni.pressSongLike(song('liked-here'));
        requests[0].take();
        await like.settled;
        const unlike = omni.pressSongLike(song('unliked-here'));
        requests[1].take();
        await unlike.settled;
        // The list as it was before both requests.
        omni.endLikedListRead(read, [song('stays'), song('unliked-here')], true);

        expect(likedIds()).toEqual(['liked-here', 'stays']);
    });

    it('keeps a like settled shortly before the read began, and lets the list decide later on', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(1_000_000);
        const requests = registerProvider();
        signIn(['stays']);
        const like = omni.pressSongLike(song('just-liked'));
        requests[0].take();
        await like.settled;

        vi.setSystemTime(1_000_000 + 2_000);
        omni.endLikedListRead(omni.beginLikedListRead(likedList)!, [song('stays')], true);
        expect(likedIds()).toEqual(['just-liked', 'stays']);

        vi.setSystemTime(1_000_000 + 30_000);
        omni.endLikedListRead(omni.beginLikedListRead(likedList)!, [song('stays')], true);
        expect(likedIds()).toEqual(['stays']);
    });

    it('begins a read only for the liked list of the account signed in', () => {
        registerProvider();
        signIn([]);

        expect(omni.beginLikedListRead({ ...likedList, isLiked: undefined })).toBeNull();
        expect(omni.beginLikedListRead({ ...likedList, id: 'someone-elses-liked-list' })).toBeNull();
        expect(omni.beginLikedListRead(likedList)).toMatchObject({ providerId, userId: 'user' });

        useOnlineProviderAccountStore.getState().clearAccount(providerId);
        expect(omni.beginLikedListRead(likedList)).toBeNull();
    });

    it('leaves the liked ids alone when another account signed in during the read', () => {
        registerProvider();
        signIn(['of-the-first-account']);
        const read = omni.beginLikedListRead(likedList)!;
        useOnlineProviderAccountStore.getState().updateAccount(providerId, {
            user: { id: 'other-user', nickname: 'Other' },
            likedSongIds: ['of-the-second-account'],
        });

        omni.endLikedListRead(read, [song('of-the-first-account')], true);

        expect(likedIds()).toEqual(['of-the-second-account']);
    });
});
