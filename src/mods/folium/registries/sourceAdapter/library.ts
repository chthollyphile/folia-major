import type { SongResult, UnifiedSong } from '@/types';
import { OnlineProviderError, type OnlineLibraryProvider, type OnlineMutationProvider, type ProviderCollection } from '@/types/onlineMusic';
import type { FoliumSourceLibrary, FoliumSourceMutations } from '../../sources/contract';
import { toHostPage, toSourceCollection, toSourceCollectionOrId, toSourceSong, toSourceSongOrId, toSourceUser } from '../sourceDtos';
import { finite, list, record, text, type SourceAdapterKit } from './kit';

// src/mods/folium/registries/sourceAdapter/library.ts
// library@1 and mutations@1 as the host's internal `library` and `mutations`: the signed-in account's own lists
// and the changes made to them. The account's id comes as a string; a song or a list goes to the source as its
// DTO, or as its id where the host hands only that.

export const buildLibrary = (kit: SourceAdapterKit, library: FoliumSourceLibrary): OnlineLibraryProvider => {
    const getSongLikeId = library.getSongLikeId?.bind(library);
    const getLikedSongIds = library.getLikedSongIds?.bind(library);
    const getLikedSongCount = library.getLikedSongCount?.bind(library);
    const areSongsLiked = library.areSongsLiked?.bind(library);
    const getUserAlbums = library.getUserAlbums?.bind(library);
    const getCloudCollection = library.getCloudCollection?.bind(library);
    const getListeningRankCollections = library.getListeningRankCollections?.bind(library);
    return {
        ...(getSongLikeId ? { getSongLikeId: kit.sync('getSongLikeId', (song: SongResult) => getSongLikeId(toSourceSong(song)), (song: SongResult) => (song.sourceRef?.kind === 'online' ? song.sourceRef.mediaId : song.id)) } : {}),
        getUserPlaylists: async (userId, limit, offset) => toHostPage(
            await kit.run('getUserPlaylists', () => library.getUserPlaylists(String(userId), limit, offset)), offset, kit.collection,
        ),
        ...(getLikedSongIds ? {
            getLikedSongIds: async (userId) => {
                const answer = record(await kit.run('getLikedSongIds', () => getLikedSongIds(String(userId))));
                return { ids: list(answer?.ids).map(text).filter(Boolean), whole: answer?.whole === true };
            },
        } : {}),
        ...(getLikedSongCount ? {
            getLikedSongCount: async (userId) => finite(await kit.run('getLikedSongCount', () => getLikedSongCount(String(userId)))) ?? null,
        } : {}),
        ...(areSongsLiked ? {
            areSongsLiked: async (ids) => {
                const answer = record(await kit.run('areSongsLiked', () => areSongsLiked(ids.map(String))));
                return Object.fromEntries(Object.entries(answer ?? {}).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'));
            },
        } : {}),
        ...(getUserAlbums ? {
            getUserAlbums: async (userId, limit, offset) => toHostPage(
                await kit.run('getUserAlbums', () => getUserAlbums(String(userId), limit, offset)), offset, kit.collection,
            ),
        } : {}),
        ...(getCloudCollection ? {
            getCloudCollection: async (user) => kit.collection(await kit.run('getCloudCollection', () => getCloudCollection(user ? toSourceUser(user) : undefined))),
        } : {}),
        ...(getListeningRankCollections ? {
            getListeningRankCollections: async (user) => kit.collections(
                await kit.run('getListeningRankCollections', () => getListeningRankCollections(toSourceUser(user))),
            ),
        } : {}),
    };
};

export const buildMutations = (kit: SourceAdapterKit, mutations: FoliumSourceMutations): OnlineMutationProvider => {
    const canAddToPlaylist = mutations.canAddToPlaylist?.bind(mutations);
    const canEditPlaylistTracks = mutations.canEditPlaylistTracks?.bind(mutations);
    const likeSong = mutations.likeSong?.bind(mutations);
    const updatePlaylistTracks = mutations.updatePlaylistTracks?.bind(mutations);
    const createPlaylist = mutations.createPlaylist?.bind(mutations);
    const canSubscribe = mutations.canSubscribe?.bind(mutations);
    const subscribePlaylist = mutations.subscribePlaylist?.bind(mutations);
    const subscribeAlbum = mutations.subscribeAlbum?.bind(mutations);
    return {
        ...(canAddToPlaylist ? {
            canAddToPlaylist: kit.sync('canAddToPlaylist', (playlist: ProviderCollection) => canAddToPlaylist(toSourceCollection(playlist)), () => false),
        } : {}),
        ...(canEditPlaylistTracks ? {
            canEditPlaylistTracks: kit.sync('canEditPlaylistTracks', (playlist: ProviderCollection) => canEditPlaylistTracks(toSourceCollection(playlist)), () => false),
        } : {}),
        ...(likeSong ? {
            likeSong: async (song, liked) => {
                await kit.run('likeSong', () => likeSong(toSourceSongOrId(song), liked));
            },
        } : {}),
        ...(updatePlaylistTracks ? {
            updatePlaylistTracks: async (operation, playlist, tracks: Array<UnifiedSong | SongResult | string | number>) => {
                await kit.run('updatePlaylistTracks', () => updatePlaylistTracks(operation, toSourceCollectionOrId(playlist), tracks.map(toSourceSongOrId)));
            },
        } : {}),
        ...(createPlaylist ? {
            createPlaylist: async (name) => {
                const made = kit.collection(await kit.run('createPlaylist', () => createPlaylist(name)));
                if (!made) throw new OnlineProviderError('invalid-response', 'createPlaylist answered no playlist', kit.context.hostId);
                return made;
            },
        } : {}),
        ...(canSubscribe ? {
            canSubscribe: kit.sync('canSubscribe', (collection: ProviderCollection) => canSubscribe(toSourceCollection(collection)), () => false),
        } : {}),
        ...(subscribePlaylist ? {
            subscribePlaylist: async (playlist, subscribed) => {
                await kit.run('subscribePlaylist', () => subscribePlaylist(toSourceCollectionOrId(playlist), subscribed));
            },
        } : {}),
        ...(subscribeAlbum ? {
            subscribeAlbum: async (id, subscribed) => {
                await kit.run('subscribeAlbum', () => subscribeAlbum(String(id), subscribed));
            },
        } : {}),
    };
};
