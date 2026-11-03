import { describe, expect, it } from 'vitest';
import type { LocalSong, SongResult } from '@/types';
import type { LocalLibraryAssignment, LocalLibraryEntity } from '@/types/localLibrary';
import type { LibraryArtistLocalLibrary } from '@/library/core/artist/artist.contract';
import {
    appendArtistAlbums,
    artistAlbumCoverUrl,
    artistAlbumLink,
    deriveLocalArtist,
    filterArtistAlbums,
    localArtistEntityId,
    mapNavidromeArtist,
    mapOnlineArtistDetail,
    toHttpsCoverUrl,
    UNKNOWN_LOCAL_ALBUM_KEY,
} from '@/library/core/artist/artistModel';
import {
    resolveLocalCatalogEntity,
    resolveLocalCatalogLink,
    resolveLocalEntitySongIds,
    resolveLocalSongEntityId,
    buildLocalCatalogIndex,
} from '@/library/core/shared/localCatalogLinks';

// test/unit/library/core/artistModel.test.ts
// 歌手页的纯变换（原 ArtistGridView 的加载分支与 useMemo）以及三处共用的本地专辑 / 歌手解析
// （宿主的嵌套打开、播放器面板、歌手页的本地分支）。

const t = (key: string, options?: Record<string, unknown>) => (options ? `${key}:${JSON.stringify(options)}` : key);

const entity = (id: string, kind: 'artist' | 'album', displayName: string, mergedInto?: string): LocalLibraryEntity => ({
    id, kind, displayName, aliases: [displayName], normalizedAliases: [displayName.toLowerCase()], mergedInto, createdAt: 0, updatedAt: 0,
});
const assignment = (songId: string, artistEntityIds: string[], albumEntityId?: string): LocalLibraryAssignment => ({
    songId, artistEntityIds, albumEntityId, artistOrigin: 'import', albumOrigin: 'import', updatedAt: 0,
});
const song = (id: string, cover?: string): LocalSong => ({ id, fileName: `${id}.mp3`, cover } as unknown as LocalSong);

// 歌手 ar1（ar-old 已合并进它），两张专辑 al1、al2（al-old 合并进 al1），s5 没有专辑归属，s9 属于另一位歌手。
const catalog = {
    ready: true,
    entities: [
        entity('ar1', 'artist', 'Artist One'),
        entity('ar-old', 'artist', 'Old Name', 'ar1'),
        entity('ar2', 'artist', 'Someone Else'),
        entity('al1', 'album', 'Alpha'),
        entity('al-old', 'album', 'Alpha (old)', 'al1'),
        entity('al2', 'album', 'Beta'),
    ],
    assignments: [
        assignment('s1', ['ar1'], 'al1'),
        assignment('s2', ['ar-old'], 'al-old'),
        assignment('s3', ['ar1', 'ar2'], 'al2'),
        assignment('s5', ['ar1']),
        assignment('s9', ['ar2'], 'al2'),
    ],
};
const songs = ['s1', 's2', 's3', 's5', 's9'].map(id => song(id, id === 's1' ? undefined : `cover-${id}`));
const local: LibraryArtistLocalLibrary = { catalog, songs };

const localDeps = {
    resolveCoverUrl: (localSong: LocalSong) => (localSong as unknown as { cover?: string }).cover,
    toTracks: (input: LocalSong[]) => input.map(item => ({ id: item.id, name: item.id, artists: [], album: { id: 0, name: '' } } as unknown as SongResult)),
    applyCover: (track: SongResult, coverUrl: string) => ({ ...track, album: { ...track.album, coverUrl } } as SongResult),
    t,
};

describe('local catalog links (shared by the host, the player panel and the artist page)', () => {
    it('follows merge redirects and matches members through them', () => {
        const link = resolveLocalCatalogLink(catalog, songs, { kind: 'artist', entityId: 'ar-old' });
        expect(link?.entity.id).toBe('ar1');
        expect(link?.songs.map(item => item.id)).toEqual(['s1', 's2', 's3', 's5']);
        expect([...resolveLocalEntitySongIds(catalog, catalog.entities[3])]).toEqual(['s1', 's2']);
    });

    it('falls back to the name only when the id resolves to nothing, and checks the kind', () => {
        expect(resolveLocalCatalogEntity(catalog, { kind: 'album', entityId: 'missing', name: 'Beta' })?.id).toBe('al2');
        // 合并掉的实体不按名字匹配。
        expect(resolveLocalCatalogEntity(catalog, { kind: 'album', name: 'Alpha (old)' })).toBeNull();
        // id 找到了但类型不对：不再按名字兜底。
        expect(resolveLocalCatalogEntity(catalog, { kind: 'album', entityId: 'ar1', name: 'Beta' })).toBeNull();
        expect(resolveLocalCatalogEntity(catalog, { kind: 'artist' })).toBeNull();
    });

    it('reads a song\'s album and first artist from its assignment', () => {
        const index = buildLocalCatalogIndex(catalog);
        expect(resolveLocalSongEntityId(index, 's2', 'album')).toBe('al-old');
        expect(resolveLocalSongEntityId(index, 's3', 'artist')).toBe('ar1');
        expect(resolveLocalSongEntityId(index, 's5', 'album')).toBeUndefined();
        expect(resolveLocalCatalogLink(catalog, songs, { kind: 'album', entityId: resolveLocalSongEntityId(index, 's2', 'album') }, index)?.entity.id).toBe('al1');
    });
});

describe('deriveLocalArtist', () => {
    it('derives the detail, the albums with cover fallback and the top songs', () => {
        const derived = deriveLocalArtist('ar-old', local, localDeps)!;
        expect(derived.detail).toEqual({
            name: 'Artist One',
            coverUrl: 'cover-s2',
            description: 'artistGrid.localArtist:{"artistName":"Artist One"}',
            trackCount: 4,
            albumCount: 3,
        });
        // al1 的第一首（s1）没封面，组里第二首（s2）补上；没归属的歌进「未知专辑」。
        expect(derived.albums).toEqual([
            { id: 'al1', name: 'Alpha', coverUrl: 'cover-s2', publishedAt: undefined, trackCount: 2 },
            { id: 'al2', name: 'Beta', coverUrl: 'cover-s3', publishedAt: undefined, trackCount: 1 },
            { id: UNKNOWN_LOCAL_ALBUM_KEY, name: 'localMusic.unknownAlbum', coverUrl: 'cover-s5', publishedAt: undefined, trackCount: 1 },
        ]);
        // s1 自己没封面：用所在专辑的封面。
        expect(derived.topSongs.map(track => [track.id, track.album?.coverUrl])).toEqual([
            ['s1', 'cover-s2'], ['s2', 'cover-s2'], ['s3', 'cover-s3'], ['s5', 'cover-s5'],
        ]);
    });

    it('keeps at most ten top songs and returns null for a missing or non-artist entity', () => {
        const many = Array.from({ length: 14 }, (_, index) => song(`m${index}`));
        const manyCatalog = {
            ready: true,
            entities: [entity('ar1', 'artist', 'Artist One')],
            assignments: many.map(item => assignment(item.id, ['ar1'])),
        };
        expect(deriveLocalArtist('ar1', { catalog: manyCatalog, songs: many }, localDeps)!.topSongs).toHaveLength(10);
        expect(deriveLocalArtist('nope', local, localDeps)).toBeNull();
        expect(deriveLocalArtist('al1', local, localDeps)).toBeNull();
    });

    it('reads the entity id from the descriptor', () => {
        expect(localArtistEntityId({ source: 'local', type: 'artist', id: 'group-x', entityId: 'ar1', name: 'A', songIds: [] })).toBe('ar1');
        expect(localArtistEntityId({ source: 'navidrome', type: 'artist', id: 'navi-ar-1', name: 'A' })).toBe('navi-ar-1');
    });
});

describe('online and Navidrome mapping', () => {
    it('maps the online detail', () => {
        expect(mapOnlineArtistDetail({
            providerId: 'p', id: 7, name: 'Main', type: 'artist', coverUrl: 'c', description: 'd', trackCount: 3, albumCount: 2, aliases: ['M'],
        })).toEqual({ id: 7, name: 'Main', coverUrl: 'c', description: 'd', trackCount: 3, albumCount: 2, aliases: ['M'] });
    });

    it('maps a Navidrome artist: cover from the first album, years, the first five albums for top songs', () => {
        const albums = Array.from({ length: 6 }, (_, index) => ({
            id: `al${index}`, name: `Album ${index}`, artist: 'A', artistId: 'ar', songCount: 1, duration: 1, created: '',
            coverArt: index === 1 ? undefined : `art${index}`, year: index === 0 ? 2001 : undefined,
        }));
        const mapped = mapNavidromeArtist({ id: 'ar', name: '', album: albums }, {
            fallbackName: 'Fallback', coverArtUrl: id => `url:${id}`, t,
        });
        expect(mapped.detail).toEqual({ name: 'Fallback', coverUrl: 'url:art0', description: 'navidrome.artists', trackCount: 0, albumCount: 6 });
        expect(mapped.albums[0]).toEqual({ id: 'al0', name: 'Album 0', coverUrl: 'url:art0', publishedAt: new Date(2001, 0, 1).getTime(), trackCount: 1 });
        expect(mapped.albums[1].coverUrl).toBeUndefined();
        expect(mapped.topSongAlbumIds).toEqual(['al0', 'al1', 'al2', 'al3', 'al4']);
    });
});

describe('albums: paging, filter, cover and link hint', () => {
    it('appends pages without duplicates', () => {
        const first = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }];
        expect(appendArtistAlbums(first, [{ id: '2', name: 'b again' }, { id: 3, name: 'c' }]).map(album => album.id)).toEqual([1, 2, 3]);
    });

    it('filters by album name only, case-insensitively', () => {
        const albums = [{ id: 1, name: 'Cedar Lane' }, { id: 2, name: 'Pine' }];
        expect(filterArtistAlbums(albums, '  cEDar ')).toEqual([albums[0]]);
        expect(filterArtistAlbums(albums, '')).toEqual(albums);
    });

    it('upgrades public http covers and leaves Subsonic / LAN covers alone', () => {
        expect(toHttpsCoverUrl('http://cdn.example.com/a.jpg')).toBe('https://cdn.example.com/a.jpg');
        expect(toHttpsCoverUrl('http://192.168.1.2/a.jpg')).toBe('http://192.168.1.2/a.jpg');
        expect(toHttpsCoverUrl('http://music.example.com/rest/getCoverArt')).toBe('http://music.example.com/rest/getCoverArt');
        expect(toHttpsCoverUrl(undefined)).toBe('');
        expect(artistAlbumCoverUrl({ coverUrl: 'http://cdn.example.com/a.jpg' })).toBe('https://cdn.example.com/a.jpg');
        expect(artistAlbumCoverUrl({ picUrl: 'legacy.jpg' })).toBeUndefined();
    });

    it('builds the link hint the host pushes with: source and provider from the artist page', () => {
        const album = { id: 'x', name: 'X', coverUrl: 'http://cdn.example.com/x.jpg', extra: 1 };
        expect(artistAlbumLink(album, { source: 'online', providerId: 'p' })).toEqual({
            id: 'x', name: 'X', coverUrl: 'https://cdn.example.com/x.jpg', extra: 1, type: 'album', source: 'online', providerId: 'p',
        });
        expect(artistAlbumLink({ ...album, providerId: 'own' }, { source: 'online', providerId: 'p' }).providerId).toBe('own');
        expect(artistAlbumLink(album, { source: 'navidrome' })).toMatchObject({ source: 'navidrome', type: 'album', providerId: undefined });
    });
});
