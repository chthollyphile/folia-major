import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import type { NavidromeConfig, SubsonicAlbum, SubsonicArtist, SubsonicPlaylist, SubsonicSong } from '@/types/navidrome';
import {
    buildNavidromeAlbumCards,
    buildNavidromeArtistCards,
    buildNavidromePlaylistCards,
    buildNavidromeSectionCards,
    EMPTY_NAVIDROME_HOME_DATA,
    isNavidromeHomeSection,
    NAVIDROME_HOME_SECTIONS,
    navidromeSectionEmptyKey,
    navidromeSectionLabelKey,
    resolveNavidromeCollectionType,
    resolveNavidromeHomeActions,
} from '@/library/core/home/navidrome/navidromeHomeModel';
import {
    createNavidromeHomeLibrary,
    loadAllNavidromeAlbums,
    NAVIDROME_ALBUM_PAGE_SIZE,
    type NavidromeHomeLibraryDeps,
} from '@/library/core/home/navidrome/navidromeHomeLibrary.service';

// test/unit/library/core/navidromeHome.test.ts
// Navidrome 页签（原 NavidromeGrid3DView 与 useNavidromeGridLibrary）：section、卡片（虚拟「随机」「收藏」带
// isVirtual）、打开时的集合类型、刷新动作；概览资源的分页、配置缺失、晚到的旧读取丢掉、失败保留数据。

const t = ((key: string) => `t:${key}`) as unknown as TFunction;
const coverArtUrl = (id: string, size?: number) => `cover:${id}@${size}`;
const config: NavidromeConfig = { serverUrl: 'http://navi', username: 'u', passwordHash: 'h' };

const album = (id: string, patch: Partial<SubsonicAlbum> = {}): SubsonicAlbum => ({
    id,
    name: `Album ${id}`,
    artist: 'Artist',
    artistId: 'ar',
    songCount: 3,
    duration: 100,
    created: '',
    ...patch,
});
const songWithCover = (id: string): SubsonicSong => ({ id, coverArt: `c-${id}` } as unknown as SubsonicSong);

describe('navidrome home model', () => {
    it('lists five sections and validates stored values', () => {
        expect(NAVIDROME_HOME_SECTIONS.map(section => section.key)).toEqual(['albums', 'recently-added', 'recently-played', 'playlists', 'artists']);
        expect(isNavidromeHomeSection('playlists')).toBe(true);
        expect(isNavidromeHomeSection('nope')).toBe(false);
        expect(isNavidromeHomeSection(null)).toBe(false);
        expect(navidromeSectionLabelKey('recently-played')).toBe('navidrome.recents');
        expect(['albums', 'playlists', 'artists'].map(key => navidromeSectionEmptyKey(key as never))).toEqual([
            'navidrome.noAlbumsFound', 'navidrome.noPlaylistsFound', 'navidrome.noArtistsFound',
        ]);
    });

    it('album cards use the cover art or a placeholder, and carry the album fields', () => {
        const [withCover, bare] = buildNavidromeAlbumCards([album('a', { coverArt: 'x', year: 2001, genre: 'Rock' }), album('b')], coverArtUrl);
        expect(withCover).toMatchObject({ id: 'a', coverUrl: 'cover:x@600', description: 'Artist', trackCount: 3, albumArtist: 'Artist', albumYear: 2001, albumGenre: 'Rock', albumDuration: 100 });
        expect(withCover.type).toBeUndefined();
        expect(bare.coverUrl).toMatch(/^data:image\/svg\+xml/);
    });

    it('playlist cards put the virtual Random and Favorites first, then editable server playlists', () => {
        const playlists: SubsonicPlaylist[] = [{ id: 'pl', name: 'Mine', owner: 'me', songCount: 4, duration: 1 }];
        const cards = buildNavidromePlaylistCards({ randomSongs: [songWithCover('r')], favoriteSongs: [], playlists }, { t, coverArtUrl });
        expect(cards.map(card => [card.id, card.type, card.isVirtual ?? false, card.editable ?? false, card.trackCount])).toEqual([
            ['__navi_random__', 'playlist', true, false, 1],
            ['__navi_favorites__', 'playlist', true, false, 0],
            ['pl', 'playlist', false, true, 4],
        ]);
        expect(cards[0].coverUrl).toBe('cover:c-r@600');
        expect(cards[1].coverUrl).toMatch(/^data:image\/svg\+xml/);
        expect(cards[2].description).toBe('me');
    });

    it('artist cards fall back to the artist image, then a placeholder', () => {
        const artists: SubsonicArtist[] = [
            { id: '1', name: 'A', coverArt: 'k', albumCount: 2 },
            { id: '2', name: 'B', artistImageUrl: 'img' },
        ];
        expect(buildNavidromeArtistCards(artists, { t, coverArtUrl }).map(card => [card.coverUrl, card.description, card.trackCount])).toEqual([
            ['cover:k@600', 't:navidrome.artists', 2],
            ['img', 't:navidrome.artists', undefined],
        ]);
    });

    it('section cards follow the section', () => {
        const data = { ...EMPTY_NAVIDROME_HOME_DATA, albums: [album('a')], recentlyAddedAlbums: [album('n')], recentlyPlayedAlbums: [album('r')] };
        expect(buildNavidromeSectionCards('albums', data, { t, coverArtUrl }).map(card => card.id)).toEqual(['a']);
        expect(buildNavidromeSectionCards('recently-added', data, { t, coverArtUrl }).map(card => card.id)).toEqual(['n']);
        expect(buildNavidromeSectionCards('recently-played', data, { t, coverArtUrl }).map(card => card.id)).toEqual(['r']);
        expect(buildNavidromeSectionCards('playlists', data, { t, coverArtUrl })).toHaveLength(2);
        expect(buildNavidromeSectionCards('artists', data, { t, coverArtUrl })).toEqual([]);
    });

    it('opening resolves album, artist, random, favorites and playlist types', () => {
        expect(resolveNavidromeCollectionType('albums', 'x')).toBe('album');
        expect(resolveNavidromeCollectionType('recently-added', 'x')).toBe('album');
        expect(resolveNavidromeCollectionType('recently-played', 'x')).toBe('album');
        expect(resolveNavidromeCollectionType('artists', 'x')).toBe('artist');
        expect(resolveNavidromeCollectionType('playlists', '__navi_random__')).toBe('random');
        expect(resolveNavidromeCollectionType('playlists', '__navi_favorites__')).toBe('favorites');
        expect(resolveNavidromeCollectionType('playlists', 'pl')).toBe('playlist');
    });

    it('refresh is disabled while loading', () => {
        expect(resolveNavidromeHomeActions(false)).toEqual([{ id: 'refresh', labelKey: 'options.audioOutputRefresh', fallbackLabel: 'Refresh', pending: false, disabled: false }]);
        expect(resolveNavidromeHomeActions(true)[0]).toMatchObject({ pending: true, disabled: true });
    });
});

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(res => {
        resolve = res;
    });
    return { promise, resolve };
};

const createDeps = (patch: Partial<NavidromeHomeLibraryDeps> = {}): NavidromeHomeLibraryDeps => ({
    getConfig: () => config,
    getAlbumList2: vi.fn(async (_config, type, size, offset = 0) => {
        if (type !== 'alphabeticalByName') return [album(`${type}-1`)];
        const total = 2 * NAVIDROME_ALBUM_PAGE_SIZE + 3;
        return Array.from({ length: Math.max(0, Math.min(size, total - offset)) }, (_, index) => album(`al-${offset + index}`));
    }),
    getPlaylists: vi.fn(async () => [{ id: 'pl', name: 'P', songCount: 1, duration: 1 }]),
    getArtists: vi.fn(async () => [{ id: 'ar', name: 'Ar' }]),
    getRandomSongs: vi.fn(async () => [songWithCover('r')]),
    getStarred2: vi.fn(async () => [songWithCover('f')]),
    ...patch,
});

describe('createNavidromeHomeLibrary', () => {
    let error: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        error = vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => error.mockRestore());

    it('pages through every alphabetical album, then reads the rest in parallel', async () => {
        const deps = createDeps();
        const library = createNavidromeHomeLibrary(deps);
        await library.load();
        const { data, isLoading } = library.getSnapshot();
        expect(isLoading).toBe(false);
        expect(data.albums).toHaveLength(2 * NAVIDROME_ALBUM_PAGE_SIZE + 3);
        expect((deps.getAlbumList2 as ReturnType<typeof vi.fn>).mock.calls.map(call => [call[1], call[2], call[3]])).toEqual([
            ['alphabeticalByName', 500, 0],
            ['alphabeticalByName', 500, 500],
            ['alphabeticalByName', 500, 1000],
            ['newest', 500, undefined],
            ['recent', 500, undefined],
        ]);
        expect(data.recentlyAddedAlbums.map(item => item.id)).toEqual(['newest-1']);
        expect(data.recentlyPlayedAlbums.map(item => item.id)).toEqual(['recent-1']);
        expect(deps.getRandomSongs).toHaveBeenCalledWith(config, 100);
        expect(data.favoriteSongs.map(item => item.id)).toEqual(['f']);
    });

    it('stops after the configured maximum of pages', async () => {
        const getAlbumList2 = vi.fn(async (_config: NavidromeConfig, _type: string, size: number) => Array.from({ length: size }, (_, index) => album(String(index))));
        const albums = await loadAllNavidromeAlbums({ getAlbumList2 }, config);
        expect(getAlbumList2).toHaveBeenCalledTimes(20);
        expect(albums).toHaveLength(20 * NAVIDROME_ALBUM_PAGE_SIZE);
    });

    it('without a configuration it reports no config and requests nothing', async () => {
        const deps = createDeps({ getConfig: () => null });
        const library = createNavidromeHomeLibrary(deps);
        expect(library.getSnapshot().config).toBeNull();
        await library.load();
        expect(library.getSnapshot()).toMatchObject({ config: null, isLoading: false });
        expect(deps.getAlbumList2).not.toHaveBeenCalled();
    });

    it('reads the configuration again on every load', async () => {
        let current: NavidromeConfig | null = null;
        const library = createNavidromeHomeLibrary(createDeps({ getConfig: () => current }));
        await library.load();
        current = config;
        await library.load();
        expect(library.getSnapshot().config).toEqual(config);
        expect(library.getSnapshot().data.playlists).toHaveLength(1);
    });

    it('a later load wins over an earlier one that answers late', async () => {
        const first = deferred<SubsonicPlaylist[]>();
        let calls = 0;
        const library = createNavidromeHomeLibrary(createDeps({
            getPlaylists: vi.fn(() => {
                calls += 1;
                return calls === 1 ? first.promise : Promise.resolve([{ id: 'new', name: 'New', songCount: 1, duration: 1 }]);
            }),
        }));
        const older = library.load();
        await new Promise(resolve => setTimeout(resolve, 0));
        await library.load();
        first.resolve([{ id: 'old', name: 'Old', songCount: 1, duration: 1 }]);
        await older;
        expect(library.getSnapshot().data.playlists.map(item => item.id)).toEqual(['new']);
    });

    it('a failure keeps the previous data and ends loading', async () => {
        let fail = false;
        const library = createNavidromeHomeLibrary(createDeps({
            getArtists: vi.fn(async () => {
                if (fail) throw new Error('down');
                return [{ id: 'ar', name: 'Ar' }];
            }),
        }));
        await library.load();
        fail = true;
        await library.load();
        expect(library.getSnapshot()).toMatchObject({ isLoading: false });
        expect(library.getSnapshot().data.artists).toHaveLength(1);
        expect(error).toHaveBeenCalledTimes(1);
    });
});
