import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appleMusicProvider } from '@/services/onlineMusic/appleMusicProvider';
import { normalizeAppleSong } from '@/services/onlineMusic/appleMusic/normalize';
import { resolveSongCatalogRef } from '@/services/onlineMusic/catalogRefs';
import { omni } from '@/services/onlineMusic/omni';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';

// test/unit/onlineMusic/appleMusicCatalog.test.ts

const song = { id: '42', type: 'songs', attributes: { name: 'Song', artistName: 'Artist', albumName: 'Album', durationInMillis: 1000, playParams: { id: '42' } } };
const detailed = { ...song, relationships: {
    artists: { data: [{ id: '7', type: 'artists', attributes: { name: 'Artist' } }] },
    albums: { data: [{ id: '9', type: 'albums', attributes: { name: 'Album' } }] },
} };
const album = { id: '9', type: 'albums', attributes: { name: 'Album', artistName: 'Artist', trackCount: 2, releaseDate: '2020-01-02', recordLabel: 'Label', artwork: { url: 'https://img/{w}x{h}.{f}' } } };

// MusicKit host stub answering by path; writes are recorded with their method and body.
const music = vi.fn();
const routes = new Map<string, unknown>();
const answer = (path: string, data: unknown) => routes.set(path, data);
beforeEach(() => {
    routes.clear();
    answer('/v1/me/storefront', { data: [{ id: 'us' }] });
    music.mockReset().mockImplementation(async (action: string, input: { path: string }) => {
        if (action !== 'api') return { ok: true, data: true };
        if (!routes.has(input.path)) return { ok: false, error: 'invalid-response' };
        return { ok: true, data: routes.get(input.path) };
    });
    vi.stubGlobal('window', { electron: { appleMusicRequest: music } });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
});
afterEach(() => vi.unstubAllGlobals());
const paths = () => music.mock.calls.filter(call => call[0] === 'api').map(call => call[1].path);

describe('Apple Music albums and artists through Omni', () => {
    it('resolves album and artist catalog refs lazily from the song resource', async () => {
        answer('/v1/catalog/us/songs/42?include=albums,artists', { data: [detailed] });
        const track = normalizeAppleSong(song);
        expect(track.artists[0].catalogRef).toBeUndefined();
        await expect(resolveSongCatalogRef(track, 'artist', { id: 0, name: 'Artist' })).resolves.toEqual({ providerId: 'applemusic', kind: 'artist', id: '7' });
        await expect(resolveSongCatalogRef(track, 'album', { id: 0, name: 'Album' })).resolves.toEqual({ providerId: 'applemusic', kind: 'album', id: '9' });
    });
    it('maps a library song to its catalog entry before reading relationships', async () => {
        answer('/v1/me/library/songs/i.lib/catalog', { data: [song] });
        answer('/v1/catalog/us/songs/42?include=albums,artists', { data: [detailed] });
        const track = normalizeAppleSong({ ...song, id: 'i.lib', attributes: { ...song.attributes, playParams: { id: 'i.lib' } } });
        await expect(resolveSongCatalogRef(track, 'album', { id: 0, name: 'Album' })).resolves.toMatchObject({ id: '9' });
        expect(paths()).toContain('/v1/me/library/songs/i.lib/catalog');
    });
    it('serves album details and tracks and stamps the album ref onto each track', async () => {
        answer('/v1/catalog/us/albums/9', { data: [album] });
        answer('/v1/catalog/us/albums/9/tracks?limit=50&offset=0', { data: [song] });
        const collection = { providerId: 'applemusic' as const, id: '9', type: 'album', name: '' };
        await expect(omni.getAlbumDetail(collection)).resolves.toMatchObject({
            type: 'album', name: 'Album', trackCount: 2, publisher: 'Label', artists: [{ name: 'Artist' }], coverUrl: 'https://img/600x600.jpg',
        });
        const page = await omni.getCollectionTracks(collection, { limit: 50, offset: 0 });
        expect(page.items[0].album).toMatchObject({ id: '9', name: 'Album', catalogRef: { kind: 'album', id: '9' } });
    });
    it('keeps library albums under the library path', async () => {
        answer('/v1/me/library/albums/l.abc/tracks?limit=100&offset=0', { data: [] });
        await omni.getCollectionTracks({ providerId: 'applemusic', id: 'l.abc', type: 'album', name: 'Mine' }, { limit: 500, offset: 0 });
        expect(paths()).toContain('/v1/me/library/albums/l.abc/tracks?limit=100&offset=0');
    });
    it('caps artist top songs at the view page size and pages albums by offset', async () => {
        answer('/v1/catalog/us/artists/7', { data: [{ id: '7', type: 'artists', attributes: { name: 'Artist', editorialNotes: { short: 'Bio' } } }] });
        answer('/v1/catalog/us/artists/7/view/top-songs?limit=20&offset=0', { data: [song], next: '/v1/catalog/us/artists/7/view/top-songs?offset=20' });
        answer('/v1/catalog/us/artists/7/albums?limit=50&offset=50', { data: [album] });
        const artist = { providerId: 'applemusic' as const, id: '7', type: 'artist', name: '' };
        await expect(omni.getArtistDetail(artist)).resolves.toMatchObject({ type: 'artist', name: 'Artist', description: 'Bio' });
        await expect(omni.getArtistSongs(artist, { limit: 50, offset: 0 })).resolves.toMatchObject({ hasMore: true, nextOffset: 20 });
        await expect(omni.getArtistAlbums(artist, { limit: 50, offset: 50 })).resolves.toMatchObject({ items: [{ type: 'album', id: '9' }] });
    });
    it('lists the library albums for the albums tab', async () => {
        answer('/v1/me/library/albums?limit=100&offset=0', { data: [{ ...album, id: 'l.1' }] });
        await expect(omni.getProviderCapabilities('applemusic').userAlbums).toBe(true);
        await expect(appleMusicProvider.library!.getUserAlbums!('applemusic', 100, 0)).resolves.toMatchObject({ items: [{ id: 'l.1', type: 'album' }] });
    });
});

describe('Apple Music favourites and playlist writes', () => {
    it('rates the catalog song for a like and clears the rating for an unlike', async () => {
        answer('/v1/me/ratings/songs/42', {});
        const track = normalizeAppleSong({ ...song, id: 'i.lib', attributes: { ...song.attributes, playParams: { id: 'i.lib', catalogId: '42' } } });
        expect(omni.canLikeSong(track)).toBe(true);
        await omni.likeSong(track, true);
        await omni.likeSong(track, false);
        expect(music.mock.calls.filter(call => call[1].path === '/v1/me/ratings/songs/42').map(call => call[1])).toEqual([
            { path: '/v1/me/ratings/songs/42', method: 'PUT', body: { type: 'rating', attributes: { value: 1 } } },
            { path: '/v1/me/ratings/songs/42', method: 'DELETE' },
        ]);
    });
    it('collects favourites from the newest library songs with both identities', async () => {
        answer('/v1/me/library/songs?limit=100&offset=0&sort=-dateAdded', { data: [
            { id: 'i.a', type: 'library-songs', attributes: { name: 'A', playParams: { catalogId: '1' } } },
            { id: 'i.b', type: 'library-songs', attributes: { name: 'B' } },
        ] });
        answer('/v1/me/ratings/library-songs?ids=i.a,i.b', { data: [{ id: 'i.a', attributes: { value: 1 } }, { id: 'i.b', attributes: { value: -1 } }] });
        await expect(omni.getProviderLikedSongIds('applemusic', 'applemusic')).resolves.toEqual(['i.a', '1']);
    });
    it('treats a rating batch failure as unrated instead of aborting the scan', async () => {
        answer('/v1/me/library/songs?limit=100&offset=0&sort=-dateAdded', { data: [{ id: 'i.a', type: 'library-songs', attributes: { name: 'A' } }] });
        await expect(omni.getProviderLikedSongIds('applemusic', 'applemusic')).resolves.toEqual([]);
    });
    it('appends tracks only to editable library playlists and never removes', async () => {
        answer('/v1/me/library/playlists/p.mine/tracks', {});
        const mine = { providerId: 'applemusic' as const, id: 'p.mine', type: 'playlist', name: 'Mine', providerData: { canEdit: true } };
        const theirs = { ...mine, id: 'p.theirs', providerData: { canEdit: false } };
        await omni.updateCollectionTracks(mine, 'add', [normalizeAppleSong(song), normalizeAppleSong({ ...song, id: 'i.lib' })]);
        expect(music.mock.calls.at(-1)?.[1]).toEqual({ path: '/v1/me/library/playlists/p.mine/tracks', method: 'POST',
            body: { data: [{ id: '42', type: 'songs' }, { id: 'i.lib', type: 'library-songs' }] } });
        await expect(omni.updateCollectionTracks(theirs, 'add', [normalizeAppleSong(song)])).rejects.toMatchObject({ code: 'unsupported' });
        await expect(omni.updateCollectionTracks(mine, 'del', [normalizeAppleSong(song)])).rejects.toMatchObject({ code: 'unsupported' });
        expect(appleMusicProvider.mutations!.canAddToPlaylist!(theirs)).toBe(false);
    });
    it('adds catalog playlists and albums to the library and reads membership from the library relationship', async () => {
        answer('/v1/me/library?ids[playlists]=pl.cat', {});
        answer('/v1/me/library?ids[albums]=9', {});
        answer('/v1/catalog/us/playlists/pl.cat/library', { data: [{ id: 'p.copy', type: 'library-playlists', attributes: { name: 'Copy' } }] });
        const playlist = { providerId: 'applemusic' as const, id: 'pl.cat', type: 'playlist', name: 'Catalog' };
        const albumCollection = { providerId: 'applemusic' as const, id: '9', type: 'album', name: 'Album' };
        expect(omni.canSubscribeCollection(playlist)).toBe(true);
        await omni.subscribe(playlist, true);
        await omni.subscribe(albumCollection, true);
        expect(music.mock.calls.filter(call => call[1].path.startsWith('/v1/me/library?')).map(call => [call[1].path, call[1].method])).toEqual([
            ['/v1/me/library?ids[playlists]=pl.cat', 'POST'], ['/v1/me/library?ids[albums]=9', 'POST'],
        ]);
        await expect(omni.getSubscriptionStatus(playlist)).resolves.toBe(true);
        await expect(omni.getSubscriptionStatus(albumCollection)).resolves.toBe(false);
        await expect(omni.getSubscriptionStatus({ ...playlist, id: 'p.mine' })).resolves.toBe(true);
        await expect(omni.subscribe(playlist, false)).rejects.toMatchObject({ code: 'unsupported' });
    });
    it('looks songs up by ISRC and pages the whole library as the cloud collection', async () => {
        answer('/v1/catalog/us/songs?filter[isrc]=USUM71703861', { data: [song] });
        answer('/v1/me/library/songs?limit=100&offset=100', { data: [{ ...song, id: 'i.lib' }], next: '/v1/me/library/songs?offset=200' });
        expect(omni.canSearchProviderSongsByIsrc('applemusic')).toBe(true);
        await expect(omni.searchProviderSongsByIsrc('applemusic', ' usum71703861 ')).resolves.toMatchObject([{ id: '42' }]);
        await expect(omni.searchProviderSongsByIsrc('applemusic', 'bad')).resolves.toEqual([]);
        const cloud = { providerId: 'applemusic' as const, id: 'library-songs', type: 'cloud', name: 'Library' };
        await expect(omni.getCollectionTracks(cloud, { limit: 100, offset: 100 })).resolves.toMatchObject({ items: [{ id: 'i.lib' }], hasMore: true, nextOffset: 200 });
        expect(omni.getProviderCapabilities('applemusic').userCloud).toBe(true);
    });
    it('requires the standalone host for account writes', async () => {
        vi.stubGlobal('window', { electron: {} });
        const capabilities = omni.getProviderCapabilities('applemusic');
        expect(capabilities).toMatchObject({ likes: true, mutations: true, albums: true, recommendations: true });
        expect(appleMusicProvider.getAvailability!().configured).toBe(false);
        await expect(omni.likeSong(normalizeAppleSong(song), true)).rejects.toMatchObject({ code: 'unavailable' });
    });
});

describe('Apple Music recommendations', () => {
    beforeEach(() => useOnlineProviderAccountStore.getState().setActiveProviderId('applemusic'));
    afterEach(() => useOnlineProviderAccountStore.getState().setActiveProviderId('netease'));
    const mix = { id: 'pl.pm-1', type: 'playlists', attributes: { name: 'Favourites Mix' } };
    const recommendations = { data: [
        { id: 'r1', type: 'personal-recommendation', relationships: { contents: { data: [mix, { id: 'ra.1', type: 'stations', attributes: { name: 'Station' } }, album] } } },
        { id: 'r2', type: 'personal-recommendation', relationships: { contents: { data: [album, { id: 'x', type: 'albums' }] } } },
    ] };
    it('flattens recommendation groups, drops stations and duplicates, then appends heavy rotation', async () => {
        answer('/v1/me/recommendations', recommendations);
        answer('/v1/me/history/heavy-rotation', { data: [{ id: 'p.h', type: 'library-playlists', attributes: { name: 'Heavy' } }, mix] });
        answer('/v1/catalog/us/charts?types=playlists&limit=10', { results: { playlists: [{ data: [{ id: 'pl.top', type: 'playlists', attributes: { name: 'Top 100' } }, mix] }] } });
        const collections = await appleMusicProvider.recommendations!.getRecommendedCollections!(10);
        expect(collections.map(item => [item.id, item.type])).toEqual([['pl.pm-1', 'playlist'], ['9', 'album'], ['p.h', 'playlist'], ['pl.top', 'playlist']]);
    });
    it('uses the personal mix for daily songs and recent plays when there is none', async () => {
        answer('/v1/me/recommendations', recommendations);
        answer('/v1/catalog/us/playlists/pl.pm-1/tracks?limit=100', { data: [song] });
        await expect(omni.getDailySongs()).resolves.toMatchObject([{ sourceRef: { providerId: 'applemusic', mediaId: '42' } }]);
        answer('/v1/me/recommendations', { data: [] });
        answer('/v1/me/recent/played/tracks', { data: [{ ...song, id: '5' }, { id: 'ra.1', type: 'stations', attributes: { name: 'S' } }] });
        await expect(omni.getDailySongs()).resolves.toMatchObject([{ id: '5' }]);
    });
    it('feeds the FM card from a recommended playlist without repeating the whole home feed', async () => {
        answer('/v1/me/recommendations', recommendations);
        answer('/v1/catalog/us/playlists/pl.pm-1/tracks?limit=100', { data: Array.from({ length: 40 }, (_, index) => ({ ...song, id: String(index) })) });
        const feed = await omni.getHomeFeed(5);
        expect(feed.personalFm).toHaveLength(30);
        expect(feed.recommendedCollections.map(item => item.id)).toEqual(['pl.pm-1', '9']);
    });
});
