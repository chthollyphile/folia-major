import { afterEach, describe, expect, it, vi } from 'vitest';
import { omni } from '@/services/onlineMusic/omni';
import { getOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import type { UnifiedSong } from '@/types';

// test/unit/ytm/ytmOmni.test.ts — the contract additions made for YouTube Music, through
// the real facade and registry: a sign-in made in the person's browser, and lyrics that only
// ever come from the other sources.

vi.mock('@/services/onlineMusic/providerAccountCache', () => ({ saveProviderAccountSnapshot: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

const songOf = (providerId: string): UnifiedSong => ({
    id: '1', name: 'Song', artists: [], album: { id: '', name: '' }, durationMs: 1,
    sourceRef: { kind: 'online', providerId, mediaId: '1' },
});

describe('sign-in in the browser through Omni', () => {
    it('registers YouTube Music as a desktop-only provider that needs an account', () => {
        const summary = omni.getProviderSummaries().find(provider => provider.providerId === 'ytm');
        expect(summary).toMatchObject({ displayName: 'YouTube Music', shortName: 'YT Music', requiresAccount: true,
            availability: { configured: false, reason: 'runtime-unavailable' } });
    });

    it('returns no QR image for the sign-in, which is confirmed in the browser, and opens the page through the provider', async () => {
        const auth = getOnlineMusicProvider('ytm')!.auth!;
        vi.spyOn(auth, 'startLogin').mockResolvedValue('web-1');
        const open = vi.spyOn(auth, 'openLoginPage').mockResolvedValue(undefined);
        expect(await omni.startLogin('ytm')).toEqual({ key: 'web-1', imageUrl: '' });
        expect(omni.confirmsLoginInBrowser('ytm')).toBe(true);
        await omni.openLoginPage('ytm', 'web-1');
        expect(open).toHaveBeenCalledExactlyOnceWith('web-1');
    });

    it('leaves QR providers on the image flow and refuses a page they do not have', async () => {
        const auth = getOnlineMusicProvider('bodian')!.auth!;
        vi.spyOn(auth, 'startLogin').mockResolvedValue('qr-key');
        vi.spyOn(auth, 'createQr').mockResolvedValue('data:image/png;base64,qr');
        expect(await omni.startLogin('bodian')).toEqual({ key: 'qr-key', imageUrl: 'data:image/png;base64,qr' });
        await expect(omni.openLoginPage('bodian', 'qr-key')).rejects.toMatchObject({ code: 'unsupported' });
    });

    it('has a sentence for a sign-in that found no browser only where the provider declares one', () => {
        expect(omni.getLoginTexts('ytm')?.caseNotes?.['no-browser']).toBe('home.loginNoBrowserYtm');
        expect(omni.getLoginTexts('bodian')?.caseNotes?.['no-browser']).toBeUndefined();
        // Asked after a failure, it does not fail itself: a provider that is not there has none.
        expect(omni.getLoginTexts('gone')).toBeNull();
    });
});

describe('the explore page, playlists and albums through the facade', () => {
    afterEach(() => {
        useOnlineProviderAccountStore.setState({ accounts: {}, activeProviderId: 'netease' });
    });

    it.each([['ytm', true], ['netease', true], ['kugou', false], ['qq', true], ['bodian', false]] as const)(
        'tells the UI whether %s has an explore page', (providerId, expected) => {
            expect(omni.supportsExplore(providerId)).toBe(expected);
        },
    );

    it('reads the active provider\'s explore page, and an empty one where the provider has none', async () => {
        // (KuGou has none.)
        useOnlineProviderAccountStore.getState().setActiveProviderId('kugou');
        expect(await omni.getExploreFeed()).toEqual({ sections: [] });
        expect(await omni.getExploreSectionItems('cursor')).toEqual({ items: [] });
        useOnlineProviderAccountStore.getState().setActiveProviderId('ytm');
        const explore = getOnlineMusicProvider('ytm')!.explore!;
        const feed = vi.spyOn(explore, 'getFeed').mockResolvedValue({ sections: [{ id: 'a', title: 'For you', items: [] }], nextCursor: 'next' });
        const more = vi.spyOn(explore, 'getSectionItems').mockResolvedValue({ items: [{ kind: 'song', song: songOf('ytm') }] });
        expect(await omni.getExploreFeed('cursor')).toEqual({ sections: [{ id: 'a', title: 'For you', items: [] }], nextCursor: 'next' });
        expect(feed).toHaveBeenCalledExactlyOnceWith('cursor', undefined);
        expect((await omni.getExploreSectionItems('more')).items).toHaveLength(1);
        expect(more).toHaveBeenCalledExactlyOnceWith('more');
    });

    it('drops an explore page that arrives after the listener switched provider', async () => {
        useOnlineProviderAccountStore.getState().setActiveProviderId('ytm');
        vi.spyOn(getOnlineMusicProvider('ytm')!.explore!, 'getFeed').mockImplementation(async () => {
            useOnlineProviderAccountStore.getState().setActiveProviderId('netease');
            return { sections: [] };
        });
        await expect(omni.getExploreFeed()).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('has the heart for a YouTube Music song, whoever is signed in', () => {
        expect(omni.canLikeSong(songOf('ytm'))).toBe(true);
    });

    it('saves an album or somebody else\'s playlist through the provider, and offers no save for an own playlist, the liked list or a mix', async () => {
        const album = { providerId: 'ytm', type: 'album', id: 'OLAK5uy_fixture', name: 'Album' };
        const save = vi.spyOn(getOnlineMusicProvider('ytm')!.mutations!, 'subscribeAlbum').mockResolvedValue(undefined);
        const state = vi.spyOn(getOnlineMusicProvider('ytm')!.catalog!, 'getSubscriptionStatus').mockResolvedValue(true);
        expect(omni.canSubscribeCollection(album)).toBe(true);
        expect(await omni.getSubscriptionStatus(album)).toBe(true);
        expect(state).toHaveBeenCalledExactlyOnceWith('album', 'OLAK5uy_fixture', album);
        await omni.subscribe(album, false);
        expect(save).toHaveBeenCalledExactlyOnceWith('OLAK5uy_fixture', false);
        const playlist = { providerId: 'ytm', type: 'playlist', id: 'PLtheirs', name: 'Saved' };
        const savePlaylist = vi.spyOn(getOnlineMusicProvider('ytm')!.mutations!, 'subscribePlaylist').mockResolvedValue(undefined);
        expect(omni.canSubscribeCollection(playlist)).toBe(true);
        await omni.subscribe(playlist, true);
        expect(savePlaylist).toHaveBeenCalledExactlyOnceWith(playlist, true);
        for (const other of [
            { ...playlist, id: 'PLmine', isOwned: true }, { ...playlist, id: 'LM', isLiked: true, isOwned: true }, { ...playlist, id: 'RDEMfixture', providerData: { mix: true } },
        ]) {
            expect(omni.canSubscribeCollection(other)).toBe(false);
            await expect(omni.subscribe(other, true)).rejects.toMatchObject({ code: 'unsupported' });
        }
        expect(savePlaylist).toHaveBeenCalledTimes(1);
    });

    it('offers only the account\'s own playlists as places to add a song', () => {
        const list = (id: string, extra: Record<string, unknown> = {}) => ({ providerId: 'ytm', type: 'playlist', id, name: id, ...extra });
        useOnlineProviderAccountStore.getState().updateAccount('ytm', {
            status: 'authenticated', user: { id: 'me', nickname: 'Me' },
            collections: [list('LM', { isLiked: true, isOwned: true }), list('PLmine', { isOwned: true }), list('PLtheirs')],
        });
        expect(omni.canAddSongToPlaylist(songOf('ytm'))).toBe(true);
        expect(omni.getPlaylistsForSong(songOf('ytm')).map(playlist => playlist.id)).toEqual(['PLmine']);
        expect(omni.canEditCollectionTracks(list('PLmine', { isOwned: true }))).toBe(true);
        // A song is taken out of the liked-music list by taking its like back (GridView.tsx).
        expect(omni.canEditCollectionTracks(list('LM', { isLiked: true, isOwned: true }))).toBe(true);
    });
});

describe('YouTube Music lyrics through the facade', () => {
    // No bridge exists under test, so the provider's own lyrics cannot be fetched.
    it('answers "none" rather than failing when the provider\'s lyrics cannot be fetched', async () => {
        expect(await omni.getLyrics(songOf('ytm'))).toMatchObject({ lyrics: null, isPureMusic: false });
    });

    it('asks the song\'s own provider for the artist\'s other name, and has none for the rest', async () => {
        const lyrics = getOnlineMusicProvider('ytm')!.lyrics!;
        const other = vi.spyOn(lyrics, 'getAlternateArtistName').mockResolvedValue('Oasis');
        expect(await omni.getAlternateArtistName(songOf('ytm'))).toBe('Oasis');
        expect(other).toHaveBeenCalledExactlyOnceWith(songOf('ytm'));
        expect(await omni.getAlternateArtistName(songOf('netease'))).toBeNull();
        expect(await omni.getAlternateArtistName({ ...songOf('ytm'), sourceRef: undefined })).toBeNull();
        expect(other).toHaveBeenCalledTimes(1);
    });
});
