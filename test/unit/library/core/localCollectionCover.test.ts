import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import type { LocalPlaylist, LocalSong } from '@/types';
import type { LocalLibraryAssignment, LocalLibraryEntity } from '@/types/localLibrary';
import type { LocalGridViewCollectionDescriptor } from '@/library/core/collection/collection.contract';
import type { LibraryMutationPort } from '@/library/core/shared/ports.contract';
import { buildLocalHomeGroups } from '@/library/core/home/localHomeModel';
import { createLocalGridViewCollection } from '@/components/app/home/gridViewCollectionAdapters';
import { deriveLocalArtist, UNKNOWN_LOCAL_ALBUM_KEY } from '@/library/core/artist/artistModel';
import {
    applyLocalArtistAlbumCoverOverrides,
    applyLocalCollectionCoverOverrides,
    buildLocalSongCoverPicks,
    localCollectionCoverKey,
    resolveLocalCollectionCover,
    resolveLocalCollectionPosterFolder,
    supportsLocalCollectionCover,
} from '@/library/core/collection/cover/localCollectionCover';
import {
    createLocalCollectionCoverRegistry,
    type LocalCollectionCoverPersistence,
    type LocalCollectionCoverRecord,
} from '@/library/core/collection/cover/localCollectionCovers.service';
import {
    createCollectionMutationController,
    type CollectionMutationOmni,
} from '@/library/core/collection/mutations/collectionMutations.service';

// test/unit/library/core/localCollectionCover.test.ts
// 本地集合的自定义封面：键在重新分组、重扫（歌变了）之后不变，首页分组与集合描述算出同一个键；自定义封面盖过
// 自动封面、不随集合里的歌变化；恢复默认回到自动封面；存储的读写顺序（晚到的读取不盖掉这次设的）；
// 能力只给本地文件夹 / 专辑 / 歌单，控制器把动作交给宿主的对话框端口。

const t = ((key: string) => key) as unknown as TFunction;
const song = (id: string, folderName: string, patch: Partial<LocalSong> = {}): LocalSong => ({
    id,
    title: `Title ${id}`,
    folderName,
    fileName: `${id}.mp3`,
    importedMetadata: { title: id, titleSource: 'filename', albumName: 'Album', artistNames: ['Artist'] },
    addedAt: Number(id.replace(/\D/g, '')) || 0,
    ...patch,
} as unknown as LocalSong);
const assetUrl = (assetId: string | undefined, size?: number) => (assetId ? `asset://${assetId}${size ? `?size=${size}` : ''}` : null);
const entity = (id: string, displayName: string): LocalLibraryEntity => ({
    id,
    kind: 'album',
    displayName,
    aliases: [displayName],
    normalizedAliases: [displayName.toLowerCase()],
    createdAt: 1,
    updatedAt: 1,
});
const assignment = (songId: string, albumEntityId: string): LocalLibraryAssignment => ({
    songId,
    artistEntityIds: [],
    artistOrigin: 'import',
    albumEntityId,
    albumOrigin: 'import',
    updatedAt: 1,
});
const playlist = (id: string, songIds: string[], name = 'Mix'): LocalPlaylist => ({ id, name, songIds, createdAt: 1, updatedAt: 1 });

describe('local collection cover keys', () => {
    it('keys folders by path, albums by entity id and playlists by playlist id', () => {
        expect(localCollectionCoverKey({ type: 'folder', id: 'folder-Music/Jazz' })).toBe('folder:Music/Jazz');
        expect(localCollectionCoverKey({ type: 'folder', id: 'folder-__all-songs__' })).toBe('folder:__all-songs__');
        expect(localCollectionCoverKey({ type: 'album', id: 'e-1', entityId: 'e-1' })).toBe('album:e-1');
        expect(localCollectionCoverKey({ type: 'playlist', id: 'playlist-p1', playlistId: 'p1' })).toBe('playlist:p1');
        // 只带 id 的歌单描述（没有 playlistId）也落到同一个键上。
        expect(localCollectionCoverKey({ type: 'playlist', id: 'playlist-p1' })).toBe('playlist:p1');
    });

    it('offers no custom cover to artists or unknown collection types', () => {
        expect(localCollectionCoverKey({ type: 'artist', id: 'e-artist', entityId: 'e-artist' })).toBeNull();
        expect(supportsLocalCollectionCover({ type: 'artist', id: 'x' })).toBe(false);
        expect(supportsLocalCollectionCover(null)).toBe(false);
        expect(supportsLocalCollectionCover({ type: 'folder', id: 'folder-A' })).toBe(true);
    });

    it('gives a home group and the collection descriptor built from it the same key', () => {
        const songs = [song('s1', 'Root/A'), song('s2', 'Root/B')];
        const catalog = { entities: [entity('e-al', 'Album')], assignments: [assignment('s1', 'e-al'), assignment('s2', 'e-al')] };
        const groups = buildLocalHomeGroups(songs, [playlist('p1', ['s2'])], t, catalog, assetUrl);
        [...groups.folders, ...groups.albums, ...groups.playlists].forEach(group => {
            expect(localCollectionCoverKey(createLocalGridViewCollection(group))).toBe(localCollectionCoverKey(group));
        });
    });

    it('keeps every key when the library is scanned again with other songs, other covers and another language', () => {
        const before = buildLocalHomeGroups(
            [song('s1', 'Root/A', { localCoverAssetId: 'c1' }), song('s2', 'Root/A')],
            [playlist('p1', ['s1'])],
            t,
            { entities: [entity('e-al', 'Album')], assignments: [assignment('s1', 'e-al')] },
            assetUrl,
        );
        // 重扫：多了一首、封面换了、歌单改了名、界面换了语言（「全部歌曲」的名字变了）。
        const otherT = ((key: string) => `other:${key}`) as unknown as TFunction;
        const after = buildLocalHomeGroups(
            [song('s3', 'Root/A', { localCoverAssetId: 'c9' }), song('s1', 'Root/A', { localCoverAssetId: 'c2' }), song('s5', 'Root/A')],
            [playlist('p1', ['s1', 's3'], 'Renamed')],
            otherT,
            { entities: [entity('e-al', 'Album (Deluxe)')], assignments: [assignment('s1', 'e-al'), assignment('s3', 'e-al')] },
            assetUrl,
        );
        const keys = (groups: typeof before) => [...groups.folders, ...groups.albums, ...groups.playlists].map(localCollectionCoverKey);
        expect(keys(after)).toEqual(keys(before));
        expect(keys(before)).toEqual(['folder:__all-songs__', 'folder:Root/A', 'album:e-al', 'album:album-__unknown__', 'playlist:p1']);
    });
});

describe('local collection cover resolution', () => {
    const overrides = new Map([['folder:Root/A', 'blob:custom-a'], ['playlist:p1', 'blob:custom-p']]);

    it('prefers the custom cover over the automatic one and falls back when none is set', () => {
        expect(resolveLocalCollectionCover({ type: 'folder', id: 'folder-Root/A' }, 'asset://auto', overrides)).toBe('blob:custom-a');
        expect(resolveLocalCollectionCover({ type: 'folder', id: 'folder-Root/B' }, 'asset://auto', overrides)).toBe('asset://auto');
        expect(resolveLocalCollectionCover({ type: 'artist', id: 'folder-Root/A' }, 'asset://auto', overrides)).toBe('asset://auto');
        expect(resolveLocalCollectionCover(null, undefined, overrides)).toBeUndefined();
    });

    it('keeps the custom cover when the songs inside change, and the automatic one follows them again once restored', () => {
        const build = (coverAssetId: string) => buildLocalHomeGroups(
            [song('s1', 'Root/A', { localCoverAssetId: coverAssetId })], [playlist('p1', ['s1'])], t, undefined, assetUrl,
        );
        const first = applyLocalCollectionCoverOverrides(build('c1').folders, overrides);
        const rescanned = applyLocalCollectionCoverOverrides(build('c2').folders, overrides);
        expect(first.find(group => group.id === 'folder-Root/A')?.coverUrl).toBe('blob:custom-a');
        expect(rescanned.find(group => group.id === 'folder-Root/A')?.coverUrl).toBe('blob:custom-a');

        const restored = applyLocalCollectionCoverOverrides(build('c2').folders, new Map());
        expect(restored.find(group => group.id === 'folder-Root/A')?.coverUrl).toBe('asset://c2?size=512');
    });

    it('only touches the groups that have a custom cover and returns the same array when none does', () => {
        const groups = buildLocalHomeGroups([song('s1', 'Root/A'), song('s2', 'Root/B')], [], t, undefined, assetUrl).folders;
        const applied = applyLocalCollectionCoverOverrides(groups, overrides);
        expect(applied).not.toBe(groups);
        expect(applied.find(group => group.id === 'folder-Root/B')).toBe(groups.find(group => group.id === 'folder-Root/B'));
        expect(applyLocalCollectionCoverOverrides(groups, new Map([['folder:Elsewhere', 'blob:x']]))).toBe(groups);
        expect(applyLocalCollectionCoverOverrides(groups, new Map())).toBe(groups);
    });

    it('shows the custom cover of an album on its local artist page, under the key of the home album group', () => {
        const songs = [
            song('s1', 'Root/A', { localCoverAssetId: 'c1' }),
            song('s2', 'Root/A', { localCoverAssetId: 'c1' }),
            song('s3', 'Root/B', { localCoverAssetId: 'c3' }),
        ];
        const artistEntity: LocalLibraryEntity = { ...entity('e-ar', 'Artist'), kind: 'artist' };
        const assignments = [
            { ...assignment('s1', 'e-al'), artistEntityIds: ['e-ar'] },
            { ...assignment('s2', 'e-al'), artistEntityIds: ['e-ar'] },
            { ...assignment('s3', ''), albumEntityId: undefined, artistEntityIds: ['e-ar'] },
        ];
        const catalog = { ready: true, failed: false, entities: [entity('e-al', 'Album'), artistEntity], assignments };
        const homeAlbum = buildLocalHomeGroups(songs, [], t, catalog, assetUrl).albums.find(group => group.entityId === 'e-al')!;
        const overrides = new Map([[localCollectionCoverKey(homeAlbum)!, 'blob:custom-album']]);

        const derived = deriveLocalArtist('e-ar', { catalog, songs } as Parameters<typeof deriveLocalArtist>[1], {
            resolveCoverUrl: item => assetUrl(item.localCoverAssetId) ?? undefined,
            toTracks: () => [],
            applyCover: track => track,
            t,
        })!;
        expect(derived.albums.map(album => [album.id, album.coverUrl])).toEqual([
            ['e-al', 'asset://c1'],
            [UNKNOWN_LOCAL_ALBUM_KEY, 'asset://c3'],
        ]);
        const applied = applyLocalArtistAlbumCoverOverrides(derived.albums, overrides);
        // 与首页那张专辑卡同一张图；「未知专辑」没有实体，不受影响。
        expect(applied.map(album => [album.id, album.coverUrl])).toEqual([
            ['e-al', applyLocalCollectionCoverOverrides([homeAlbum], overrides)[0].coverUrl],
            [UNKNOWN_LOCAL_ALBUM_KEY, 'asset://c3'],
        ]);
        expect(applied[0].coverUrl).toBe('blob:custom-album');
        // 没有要换的（或已恢复默认）时原样返回，下游的 memo 不白算。
        expect(applyLocalArtistAlbumCoverOverrides(derived.albums, new Map())).toBe(derived.albums);
        expect(applyLocalArtistAlbumCoverOverrides(derived.albums, new Map([['folder:Root/A', 'blob:x']]))).toBe(derived.albums);
    });
});

describe('poster.png folder and song cover picks', () => {
    it('looks for poster.png in a real folder, or in the one folder an album lives in', () => {
        expect(resolveLocalCollectionPosterFolder({ type: 'folder', id: 'folder-Root/A', name: 'Root/A' }, [])).toBe('Root/A');
        expect(resolveLocalCollectionPosterFolder({ type: 'folder', id: 'folder-__all-songs__', isVirtual: true }, [])).toBeNull();
        expect(resolveLocalCollectionPosterFolder({ type: 'album', id: 'e' }, [song('1', 'Root/A'), song('2', 'Root/A')])).toBe('Root/A');
        expect(resolveLocalCollectionPosterFolder({ type: 'album', id: 'e' }, [song('1', 'Root/A'), song('2', 'Root/B')])).toBeNull();
        expect(resolveLocalCollectionPosterFolder({ type: 'playlist', id: 'playlist-p' }, [song('1', 'Root/A')])).toBeNull();
    });

    it('lists each distinct song cover once, in collection order, skipping songs without one', () => {
        const picks = buildLocalSongCoverPicks([
            song('s1', 'A', { localCoverAssetId: 'c1' }),
            song('s2', 'A'),
            song('s3', 'A', { localCoverAssetId: 'c1' }),
            song('s4', 'A', { useOnlineCover: true, localCoverAssetId: 'c1', onlineMetadata: { coverUrl: 'https://img/o.jpg' } as LocalSong['onlineMetadata'] }),
        ], assetUrl, 256);
        expect(picks).toEqual([
            { songId: 's1', title: 'Title s1', coverUrl: 'asset://c1?size=256', songCount: 2 },
            { songId: 's4', title: 'Title s4', coverUrl: 'https://img/o.jpg', songCount: 1 },
        ]);
    });
});

const memoryPersistence = (initial: LocalCollectionCoverRecord[] = []) => {
    const records = new Map(initial.map(record => [record.key, record]));
    let release: (() => void) | null = null;
    const persistence: LocalCollectionCoverPersistence & { letGo: () => void; records: typeof records } = {
        records,
        letGo: () => release?.(),
        readAll: vi.fn(() => new Promise<LocalCollectionCoverRecord[]>(resolve => {
            const snapshot = [...records.values()];
            release = () => resolve(snapshot);
        })),
        write: vi.fn(async (record: LocalCollectionCoverRecord) => { records.set(record.key, record); }),
        remove: vi.fn(async (key: string) => { records.delete(key); }),
    };
    return persistence;
};

const urlFactory = () => {
    let next = 0;
    const revoked: string[] = [];
    return { createUrl: vi.fn(() => `blob:${++next}`), revokeUrl: vi.fn((url: string) => { revoked.push(url); }), revoked };
};

describe('local collection cover registry', () => {
    const image = (text: string) => new Blob([text], { type: 'image/webp' });

    it('loads the stored covers on the first subscriber, once', async () => {
        const persistence = memoryPersistence([{ key: 'folder:A', blob: image('a'), origin: 'poster', updatedAt: 1 }]);
        const urls = urlFactory();
        const registry = createLocalCollectionCoverRegistry({ persistence, ...urls });
        const listener = vi.fn();
        registry.subscribe(listener);
        registry.subscribe(() => {});
        persistence.letGo();
        await registry.hydrate();
        expect(persistence.readAll).toHaveBeenCalledTimes(1);
        expect(registry.getSnapshot().get('folder:A')).toBe('blob:1');
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('stores the image bytes themselves and replaces the URL, releasing the old one', async () => {
        const persistence = memoryPersistence();
        const urls = urlFactory();
        const registry = createLocalCollectionCoverRegistry({ persistence, ...urls, now: () => 42 });
        const first = image('first');
        await registry.set('album:e', first, 'song');
        expect(persistence.records.get('album:e')).toEqual({ key: 'album:e', blob: first, origin: 'song', updatedAt: 42 });
        const before = registry.getSnapshot();
        await registry.set('album:e', image('second'), 'upload');
        expect(registry.getSnapshot()).not.toBe(before);
        expect(registry.getSnapshot().get('album:e')).toBe('blob:2');
        expect(urls.revoked).toEqual(['blob:1']);
    });

    it('restores the default by dropping the record and the URL', async () => {
        const persistence = memoryPersistence();
        const urls = urlFactory();
        const registry = createLocalCollectionCoverRegistry({ persistence, ...urls });
        await registry.set('playlist:p', image('p'), 'upload');
        await registry.clear('playlist:p');
        expect(registry.getSnapshot().has('playlist:p')).toBe(false);
        expect(persistence.records.has('playlist:p')).toBe(false);
        expect(urls.revoked).toEqual(['blob:1']);
        expect(resolveLocalCollectionCover({ type: 'playlist', id: 'playlist-p' }, 'asset://auto', registry.getSnapshot())).toBe('asset://auto');
    });

    it('does not let a late storage read bring back a cover set or cleared since', async () => {
        const persistence = memoryPersistence([
            { key: 'folder:A', blob: image('old-a'), origin: 'poster', updatedAt: 1 },
            { key: 'folder:B', blob: image('old-b'), origin: 'poster', updatedAt: 1 },
        ]);
        const urls = urlFactory();
        const registry = createLocalCollectionCoverRegistry({ persistence, ...urls });
        const hydration = registry.hydrate();
        await registry.set('folder:A', image('new-a'), 'upload');
        await registry.clear('folder:B');
        persistence.letGo();
        await hydration;
        expect([...registry.getSnapshot().entries()]).toEqual([['folder:A', 'blob:1']]);
    });

    it('keeps what is shown when the write fails', async () => {
        const persistence = memoryPersistence();
        persistence.write = vi.fn(async () => { throw new Error('quota'); });
        const registry = createLocalCollectionCoverRegistry({ persistence, ...urlFactory() });
        const before = registry.getSnapshot();
        await expect(registry.set('folder:A', image('a'), 'upload')).rejects.toThrow('quota');
        expect(registry.getSnapshot()).toBe(before);
    });
});

describe('set-cover collection action', () => {
    const omni = {
        canEditCollectionTracks: () => false,
        canSubscribeCollection: () => false,
        canDislikeCollectionSongs: () => false,
    } as unknown as CollectionMutationOmni;
    const local = (patch: Partial<LocalGridViewCollectionDescriptor>): LocalGridViewCollectionDescriptor => ({
        source: 'local', id: 'folder-Root/A', name: 'Root/A', type: 'folder', songIds: [], ...patch,
    });
    const controllerFor = (descriptor: LocalGridViewCollectionDescriptor, port: LibraryMutationPort) => createCollectionMutationController({
        descriptor, resource: null, port, omni, removeCacheEntry: async () => {},
    });

    it('is offered to local folders, albums and playlists, not to artists or without the host dialog', () => {
        const port: LibraryMutationPort = { local: { editCover: vi.fn() } };
        expect(controllerFor(local({}), port).getSnapshot().capabilities.setCover).toEqual({ supported: true, enabled: true, pending: false });
        expect(controllerFor(local({ id: 'folder-__all-songs__', isVirtual: true }), port).getSnapshot().capabilities.setCover.supported).toBe(true);
        expect(controllerFor(local({ type: 'album', id: 'e', entityId: 'e' }), port).getSnapshot().capabilities.setCover.supported).toBe(true);
        expect(controllerFor(local({ type: 'playlist', id: 'playlist-p', playlistId: 'p' }), port).getSnapshot().capabilities.setCover.supported).toBe(true);
        expect(controllerFor(local({ type: 'artist', id: 'e', entityId: 'e' }), port).getSnapshot().capabilities.setCover.supported).toBe(false);
        expect(controllerFor(local({}), {}).getSnapshot().capabilities.setCover.supported).toBe(false);
    });

    it('hands the collection to the host dialog and refuses where it is not offered', async () => {
        const editCover = vi.fn();
        const descriptor = local({ type: 'playlist', id: 'playlist-p', playlistId: 'p' });
        expect(await controllerFor(descriptor, { local: { editCover } }).setCover()).toEqual({ ok: true });
        expect(editCover).toHaveBeenCalledWith(descriptor);
        expect(await controllerFor(local({ type: 'artist', id: 'e' }), { local: { editCover } }).setCover())
            .toEqual({ ok: false, reason: 'unsupported' });
        expect(editCover).toHaveBeenCalledTimes(1);
    });
});
