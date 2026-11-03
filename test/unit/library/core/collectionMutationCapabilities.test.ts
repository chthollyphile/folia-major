import { describe, expect, it } from 'vitest';
import type { MediaId } from '@/types/onlineMusic';
import type { LibraryCollectionDescriptor } from '@/library/core/collection/collection.contract';
import type { CollectionResourceKind } from '@/library/core/shared/resource.contract';
import type { LibraryMutationPort } from '@/library/core/shared/ports.contract';
import { isCloudDriveCollection } from '@/library/core/collection/collectionIdentity';
import {
    EMPTY_COLLECTION_MUTATION_SNAPSHOT,
    resolveCollectionMutationBranches,
    resolveCollectionMutationCapabilities,
    resolveEntryRemovalKind,
    type CollectionMutationCapabilityState,
} from '@/library/core/collection/mutations/collectionMutationCapabilities';

// test/unit/library/core/collectionMutationCapabilities.test.ts
// 变更能力的规则与 GridView 原先的分支布尔逐项对照：下面的 gridViewReference 是 GridView.tsx 里
// 那段代码的原样拷贝（只把 omni 换成注入的函数、sourceActions 换成由端口转接），
// 在一组来源 × 资源 × 用户 × 日期 × 端口的组合上比对，任何一项改了语义都会在这里暴露。

const canEditCollectionTracks = (collection: any) => collection.providerId === 'editable';
const canSubscribeCollection = (collection: any) => collection.providerId !== 'nosub';
// 有日推却没有「不喜欢」的 provider（QQ）：管理推荐必定失败，不该给编辑。
const canDislikeCollectionSongs = (collection: any) => collection.providerId !== 'nodislike';

const toSourceActions = (port: LibraryMutationPort) => ({
    local: {
        onResyncFolder: port.local?.resyncFolder,
        onResyncAllFolders: port.local?.resyncAllFolders,
        onOrganizeFolderSongInfo: port.local?.organizeFolder,
        onExportPlaylist: port.local?.exportPlaylist,
        onEditEntity: port.local?.editEntity,
    },
    navidrome: {
        onAddToPlaylist: port.navidrome?.addToPlaylist,
        onCreatePlaylist: port.navidrome?.createPlaylist,
    },
});

/* eslint-disable @typescript-eslint/no-explicit-any */
// GridView.tsx（P1 末）里的分支布尔与按钮条件，原样。
const gridViewReference = ({
    collection,
    isOnlineResource,
    currentUserId,
    selectedDailyRecommendationDate,
    sourceActions,
}: {
    collection: any;
    isOnlineResource: boolean;
    currentUserId: MediaId | null;
    selectedDailyRecommendationDate: string;
    sourceActions: ReturnType<typeof toSourceActions>;
}) => {
    const collectionSource = collection?.source as string | undefined;
    const isLocalCollection = collectionSource === 'local';
    const isNavidromeCollection = collectionSource === 'navidrome';
    const isDailyRecommendationsCollection = collectionSource === 'online' && collection?.type === 'daily_recommendations';
    const isLocalFolderCollection = isLocalCollection && collection?.type === 'folder' && !collection?.isVirtual;
    const isLocalAllSongsCollection = isLocalCollection && collection?.type === 'folder' && Boolean(collection?.isVirtual);
    const isLocalPlaylistCollection = isLocalCollection && collection?.type === 'playlist' && Boolean(collection?.playlistId) && !collection?.isVirtual;
    const isLocalEntityCollection = isLocalCollection && Boolean(collection?.entityId);
    const isNavidromePlaylistCollection = isNavidromeCollection && collection?.type === 'playlist' && Boolean(collection?.editable);
    const canAddNavidromeToPlaylist = isNavidromeCollection
        && collection?.type !== 'playlist'
        && Boolean(sourceActions?.navidrome?.onAddToPlaylist || sourceActions?.navidrome?.onCreatePlaylist);
    const isCloudDrive = collection ? isCloudDriveCollection(collection) : false;
    const canEditOnlineCollectionTracks = Boolean(
        collectionSource === 'online'
        && collection
        && canEditCollectionTracks(collection),
    );
    const canEditOwnedPlaylist = isOnlineResource
        && collection
        && collectionSource === 'online'
        && collection.type === 'playlist'
        && Boolean(currentUserId != null && collection.creator?.id === currentUserId)
        && canEditOnlineCollectionTracks;
    const canEditProviderPlaylist = isOnlineResource
        && collectionSource === 'online'
        && collection?.type === 'playlist'
        && collection?.isOwned === true
        && canEditOnlineCollectionTracks;
    const canEditPlaylist = Boolean(
        canEditOwnedPlaylist
        || canEditProviderPlaylist
        || (isDailyRecommendationsCollection && !selectedDailyRecommendationDate && canDislikeCollectionSongs(collection))
        || isLocalPlaylistCollection
        || isNavidromePlaylistCollection
    );
    const isOnlinePlaylist = collectionSource === 'online' && collection?.type === 'playlist' && !isCloudDrive;
    const isOnlineAlbum = collectionSource === 'online' && collection?.type === 'album' && !isCloudDrive;
    const showSubscribeButton = Boolean(
        collection
        && canSubscribeCollection(collection)
        && ((isOnlinePlaylist && !canEditOwnedPlaylist && !canEditProviderPlaylist) || isOnlineAlbum),
    );

    return {
        branches: {
            isLocalCollection,
            isNavidromeCollection,
            isDailyRecommendationsCollection,
            isLocalFolderCollection,
            isLocalAllSongsCollection,
            isLocalPlaylistCollection,
            isLocalEntityCollection,
            isNavidromePlaylistCollection,
            isCloudDrive,
            isOnlinePlaylist,
            isOnlineAlbum,
            canEditOnlineCollectionTracks,
            canEditOwnedPlaylist: Boolean(canEditOwnedPlaylist),
            canEditProviderPlaylist: Boolean(canEditProviderPlaylist),
            canEditPlaylist,
            showSubscribeButton,
            canAddNavidromeToPlaylist,
        },
        // 按钮的渲染条件（GridView 信息面板与 gridSurfaceParams）。
        buttons: {
            subscribe: showSubscribeButton,
            editCollection: canEditPlaylist,
            rename: isLocalPlaylistCollection || isNavidromePlaylistCollection,
            deleteCollection: isLocalFolderCollection || isLocalPlaylistCollection || isNavidromePlaylistCollection,
            resyncFolder: isLocalFolderCollection && Boolean(sourceActions?.local?.onResyncFolder),
            resyncAllFolders: isLocalAllSongsCollection && Boolean(sourceActions?.local?.onResyncAllFolders),
            organizeSongInfo: isLocalFolderCollection && Boolean(sourceActions?.local?.onOrganizeFolderSongInfo),
            exportPlaylist: isLocalCollection
                && collection?.type === 'playlist'
                && Boolean(collection.playlistId)
                && Boolean(sourceActions?.local?.onExportPlaylist),
            editEntity: isLocalEntityCollection && Boolean(sourceActions?.local?.onEditEntity),
            addToPlaylistPicker: canAddNavidromeToPlaylist,
        },
    };
};
/* eslint-enable @typescript-eslint/no-explicit-any */

const noop = async () => {};
const FULL_PORT: LibraryMutationPort = {
    local: {
        removePlaylistSongs: noop,
        refresh: noop,
        renamePlaylist: noop,
        deletePlaylist: noop,
        deleteFolder: noop,
        resyncFolder: noop,
        resyncAllFolders: noop,
        exportPlaylist: noop,
        editEntity: noop,
        organizeFolder: noop,
        matchSong: noop,
    },
    navidrome: {
        removePlaylistSongs: noop,
        renamePlaylist: noop,
        deletePlaylist: noop,
        addToPlaylist: noop,
        createPlaylist: noop,
    },
};
const PORTS: Array<[string, LibraryMutationPort]> = [
    ['full port', FULL_PORT],
    ['empty port', {}],
    ['create-only navidrome', { navidrome: { createPlaylist: noop } }],
];

const DESCRIPTORS: LibraryCollectionDescriptor[] = [
    { source: 'local', id: 'f', name: 'Folder', type: 'folder', songIds: [] },
    { source: 'local', id: 'all', name: 'All', type: 'folder', songIds: [], isVirtual: true },
    { source: 'local', id: 'p', name: 'Playlist', type: 'playlist', songIds: [], playlistId: 'pl-1' },
    { source: 'local', id: 'fav', name: 'Favorites', type: 'playlist', songIds: [], playlistId: 'pl-fav', isVirtual: true },
    { source: 'local', id: 'p2', name: 'Orphan', type: 'playlist', songIds: [] },
    { source: 'local', id: 'al', name: 'Album', type: 'album', songIds: [], entityId: 'e-al' },
    { source: 'local', id: 'ar', name: 'Artist', type: 'artist', songIds: [], entityId: 'e-ar' },
    { source: 'navidrome', id: 'np', name: 'Navi', type: 'playlist', editable: true },
    { source: 'navidrome', id: 'np2', name: 'Navi RO', type: 'playlist' },
    { source: 'navidrome', id: 'na', name: 'Navi Album', type: 'album' },
    { source: 'navidrome', id: 'random', name: 'Random', type: 'random' },
    ...(['editable', 'readonly', 'nosub', 'nodislike'] as const).flatMap((providerId): LibraryCollectionDescriptor[] => [
        { source: 'online', providerId, id: 'pl', name: 'Mine', type: 'playlist', creator: { id: 'u1', nickname: 'me' } },
        { source: 'online', providerId, id: 'pl2', name: 'Theirs', type: 'playlist', creator: { id: 'u2', nickname: 'them' } },
        { source: 'online', providerId, id: 'pl3', name: 'Owned', type: 'playlist', isOwned: true },
        { source: 'online', providerId, id: 'liked', name: 'Liked', type: 'playlist', isLiked: true, creator: { id: 'u1', nickname: 'me' } },
        { source: 'online', providerId, id: 'al', name: 'Album', type: 'album' },
        { source: 'online', providerId, id: 'cloud', name: 'Cloud', type: 'cloud' },
        { source: 'online', providerId, id: -100, name: 'Cloud drive', type: 'playlist', isOwned: true },
        { source: 'online', providerId, id: 'daily', name: 'Daily', type: 'daily_recommendations' },
        { source: 'online', providerId, id: 'personal_fm', name: 'FM', type: 'radio' },
        { source: 'online', providerId, id: 'ar', name: 'Artist', type: 'artist' },
    ]),
];

const describeDescriptor = (descriptor: LibraryCollectionDescriptor) => (
    `${descriptor.source}:${descriptor.source === 'online' ? `${descriptor.providerId}:` : ''}${descriptor.type}:${descriptor.id}`
);

const IDLE: CollectionMutationCapabilityState = {
    hasResource: true,
    pendingRemovalCount: 0,
    subscribing: false,
    sourceActionPending: false,
    dailyLimitReached: false,
    dailyDatePending: false,
};

const resolveFor = (
    descriptor: LibraryCollectionDescriptor,
    {
        resourceKind = 'online',
        currentUserId = 'u1',
        dailyDate = '',
        port = FULL_PORT,
        state = IDLE,
    }: {
        resourceKind?: CollectionResourceKind | null;
        currentUserId?: MediaId | null;
        dailyDate?: string;
        port?: LibraryMutationPort;
        state?: CollectionMutationCapabilityState;
    } = {},
) => {
    const online = descriptor.source === 'online' ? descriptor : null;
    const branches = resolveCollectionMutationBranches({
        descriptor,
        resourceKind,
        currentUserId,
        canEditCollectionTracks: online ? canEditCollectionTracks(online) : false,
        canSubscribeCollection: online ? canSubscribeCollection(online) : false,
        canDislikeCollectionSongs: online ? canDislikeCollectionSongs(online) : false,
        isCloudDrive: isCloudDriveCollection(descriptor),
        dailyDate,
        port,
    });
    return { branches, capabilities: resolveCollectionMutationCapabilities({ descriptor, branches, port, state }) };
};

describe('collection mutation branches match GridView', () => {
    const resourceKinds: Array<CollectionResourceKind | null> = ['online', 'static', 'navidrome', null];
    const users: Array<MediaId | null> = ['u1', null];
    const dates = ['', '2024-01-01'];

    it.each(DESCRIPTORS.map(descriptor => [describeDescriptor(descriptor), descriptor] as const))(
        '%s: every branch and button condition is the one GridView used',
        (_label, descriptor) => {
            for (const resourceKind of resourceKinds) {
                for (const currentUserId of users) {
                    for (const dailyDate of dates) {
                        for (const [portLabel, port] of PORTS) {
                            const context = `${resourceKind} / user ${currentUserId} / date '${dailyDate}' / ${portLabel}`;
                            const reference = gridViewReference({
                                collection: descriptor,
                                isOnlineResource: resourceKind === 'online',
                                currentUserId,
                                selectedDailyRecommendationDate: dailyDate,
                                sourceActions: toSourceActions(port),
                            });
                            const { branches, capabilities } = resolveFor(descriptor, { resourceKind, currentUserId, dailyDate, port });
                            expect(branches, context).toEqual(reference.branches);
                            expect({
                                subscribe: capabilities.subscribe.supported,
                                editCollection: capabilities.editCollection.supported,
                                rename: capabilities.rename.supported,
                                deleteCollection: capabilities.deleteCollection.supported,
                                resyncFolder: capabilities.resyncFolder.supported,
                                resyncAllFolders: capabilities.resyncAllFolders.supported,
                                organizeSongInfo: capabilities.organizeSongInfo.supported,
                                exportPlaylist: capabilities.exportPlaylist.supported,
                                editEntity: capabilities.editEntity.supported,
                                addToPlaylistPicker: capabilities.addToPlaylist.supported || capabilities.createPlaylist.supported,
                            }, context).toEqual(reference.buttons);
                        }
                    }
                }
            }
        },
    );

    it('spot checks the cases the matrix is about', () => {
        const owned = DESCRIPTORS.find(d => d.source === 'online' && d.providerId === 'editable' && d.id === 'pl')!;
        expect(resolveFor(owned).branches).toMatchObject({ canEditOwnedPlaylist: true, showSubscribeButton: false });
        // 用户信息晚到：先显示订阅按钮，知道是自己的歌单之后变成可编辑。
        expect(resolveFor(owned, { currentUserId: null }).branches).toMatchObject({ canEditOwnedPlaylist: false, showSubscribeButton: true });
        // 在线歌单只有拿到在线资源时才能编辑。
        expect(resolveFor(owned, { resourceKind: 'static' }).branches.canEditOwnedPlaylist).toBe(false);

        const cloudDrive = DESCRIPTORS.find(d => d.source === 'online' && d.providerId === 'editable' && d.id === -100)!;
        expect(resolveFor(cloudDrive).branches).toMatchObject({ isCloudDrive: true, isOnlinePlaylist: false, showSubscribeButton: false, canEditProviderPlaylist: true });

        const daily = DESCRIPTORS.find(d => d.source === 'online' && d.type === 'daily_recommendations')!;
        expect(resolveFor(daily).branches.canEditPlaylist).toBe(true);
        expect(resolveFor(daily, { dailyDate: '2024-01-01' }).branches.canEditPlaylist).toBe(false);
        // 有日推、没有「不喜欢」（QQ）：管理推荐就是逐首不喜欢，给了按钮也只会失败。
        const dailyWithoutDislike = DESCRIPTORS.find(d => d.source === 'online' && d.providerId === 'nodislike' && d.type === 'daily_recommendations')!;
        expect(resolveFor(dailyWithoutDislike).branches.canEditPlaylist).toBe(false);
        expect(resolveFor(dailyWithoutDislike).capabilities.removeEntry.supported).toBe(false);

        const favorites = DESCRIPTORS.find(d => d.source === 'local' && d.id === 'fav')!;
        // 收藏是虚拟歌单：不能改名、不能删，但能导出（与网格的按钮一致）。
        expect(resolveFor(favorites).capabilities).toMatchObject({
            rename: { supported: false },
            deleteCollection: { supported: false },
            exportPlaylist: { supported: true },
        });
    });
});

describe('entry removal kind', () => {
    const find = (predicate: (descriptor: LibraryCollectionDescriptor) => boolean) => DESCRIPTORS.find(predicate)!;

    it('follows the GridView branch order and needs the matching port', () => {
        const daily = find(d => d.type === 'daily_recommendations');
        const localPlaylist = find(d => d.source === 'local' && d.id === 'p');
        const naviPlaylist = find(d => d.source === 'navidrome' && d.id === 'np');
        const owned = find(d => d.source === 'online' && d.providerId === 'editable' && d.id === 'pl');
        const theirs = find(d => d.source === 'online' && d.providerId === 'editable' && d.id === 'pl2');
        const kindOf = (descriptor: LibraryCollectionDescriptor, options: Parameters<typeof resolveFor>[1] = {}) => {
            const port = options.port ?? FULL_PORT;
            return resolveEntryRemovalKind(resolveFor(descriptor, options).branches, port);
        };

        expect(kindOf(daily)).toBe('daily-dislike');
        expect(kindOf(daily, { dailyDate: '2024-01-01' })).toBeNull();
        expect(kindOf(localPlaylist)).toBe('local-playlist');
        expect(kindOf(localPlaylist, { port: {} })).toBeNull();
        expect(kindOf(naviPlaylist)).toBe('navidrome-playlist');
        expect(kindOf(naviPlaylist, { port: {} })).toBeNull();
        expect(kindOf(owned)).toBe('online-playlist');
        expect(kindOf(theirs)).toBeNull();
        expect(kindOf(find(d => d.source === 'local' && d.id === 'f'))).toBeNull();
    });
});

describe('collection mutation capabilities: state', () => {
    const localPlaylist = DESCRIPTORS.find(d => d.source === 'local' && d.id === 'p')!;
    const localFolder = DESCRIPTORS.find(d => d.source === 'local' && d.id === 'f')!;
    const localAlbum = DESCRIPTORS.find(d => d.source === 'local' && d.id === 'al')!;

    it('greys out the shared source actions while one runs, but not the dialogs', () => {
        const state = { ...IDLE, sourceActionPending: true };
        const pending = { supported: true, enabled: false, pending: true, reason: 'pending' };
        expect(resolveFor(localPlaylist, { state }).capabilities).toMatchObject({
            editCollection: pending,
            rename: pending,
            deleteCollection: pending,
            exportPlaylist: pending,
            matchSong: { supported: true, enabled: true },
        });
        expect(resolveFor(localFolder, { state }).capabilities).toMatchObject({
            resyncFolder: pending,
            organizeSongInfo: { supported: true, enabled: true, pending: false },
        });
        expect(resolveFor(localAlbum, { state }).capabilities.editEntity).toEqual({ supported: true, enabled: true, pending: false });
    });

    it('keeps the subscription toggle pressable while its request runs (the star shows a press at once)', () => {
        const album = DESCRIPTORS.find(d => d.source === 'online' && d.providerId === 'editable' && d.type === 'album')!;
        expect(resolveFor(album).capabilities.subscribe).toEqual({ supported: true, enabled: true, pending: false });
        expect(resolveFor(album, { state: { ...IDLE, subscribing: true } }).capabilities.subscribe)
            .toEqual({ supported: true, enabled: true, pending: false });
    });

    it('serializes daily and Navidrome removals, lets song-keyed removals run side by side', () => {
        const daily = DESCRIPTORS.find(d => d.type === 'daily_recommendations')!;
        const navi = DESCRIPTORS.find(d => d.source === 'navidrome' && d.id === 'np')!;
        const owned = DESCRIPTORS.find(d => d.source === 'online' && d.providerId === 'editable' && d.id === 'pl')!;
        const busy = { ...IDLE, pendingRemovalCount: 1 };

        expect(resolveFor(daily, { state: busy }).capabilities.removeEntry).toEqual({ supported: true, enabled: false, pending: true, reason: 'pending' });
        expect(resolveFor(navi, { state: busy }).capabilities.removeEntry).toEqual({ supported: true, enabled: false, pending: true, reason: 'pending' });
        expect(resolveFor(owned, { state: busy }).capabilities.removeEntry).toEqual({ supported: true, enabled: true, pending: true });
        expect(resolveFor(localPlaylist, { state: busy }).capabilities.removeEntry).toEqual({ supported: true, enabled: true, pending: true });
    });

    it('marks daily removal as limit-reached once upstream ran out', () => {
        const daily = DESCRIPTORS.find(d => d.type === 'daily_recommendations')!;
        expect(resolveFor(daily, { state: { ...IDLE, dailyLimitReached: true } }).capabilities.removeEntry)
            .toEqual({ supported: true, enabled: false, pending: false, reason: 'limit-reached' });
    });

    it('needs a resource to switch the daily date', () => {
        const daily = DESCRIPTORS.find(d => d.type === 'daily_recommendations')!;
        expect(resolveFor(daily).capabilities.dailyDate.supported).toBe(true);
        expect(resolveFor(daily, { state: { ...IDLE, hasResource: false } }).capabilities.dailyDate.supported).toBe(false);
        expect(resolveFor(daily, { state: { ...IDLE, dailyDatePending: true } }).capabilities.dailyDate)
            .toEqual({ supported: true, enabled: false, pending: true, reason: 'pending' });
    });

    it('supports nothing without a collection', () => {
        const capabilities = Object.values(EMPTY_COLLECTION_MUTATION_SNAPSHOT.capabilities);
        expect(capabilities.length).toBeGreaterThan(0);
        expect(capabilities.every(capability => !capability.supported && capability.reason === 'unsupported')).toBe(true);
        expect(Object.values(EMPTY_COLLECTION_MUTATION_SNAPSHOT.branches).every(value => value === false)).toBe(true);
    });
});
