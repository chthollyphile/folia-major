import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalSong } from '../../types';
import type { FoliaPlaylist } from '../../types/foliaPlaylist';
import { reorderFoliaPlaylistEntries } from '../../services/foliaPlaylist/foliaPlaylistService';
import { getFoliaEntryLocalSongId } from '../../utils/foliaPlaylistEntries';
import { buildLocalQueue, LIST_ROW_COVER_SIZE, type LocalLibraryDisplayCatalog } from '../../services/playbackAdapters';
import FoliaPlaylistOrderDialog from './FoliaPlaylistOrderDialog';
import type { OrderSong } from './playlistOrderDraft';

// Keeps the playlist snapshot used to start a draft until the editor is closed.

type Props = {
    playlist: FoliaPlaylist;
    localSongs: readonly LocalSong[];
    catalog: LocalLibraryDisplayCatalog;
    isDaylight: boolean;
    onClose: () => void;
    onRefresh: () => Promise<void> | void;
};

// The rows show what the playlist page shows: the same artist, album and cover as the grid's list.
// A row's id is the entry key, so the whole playlist is ordered here, whatever source a row comes from;
// a row that is not a local song shows the snapshot the playlist keeps of it.
const buildOrderSongs = (playlist: FoliaPlaylist, localSongs: readonly LocalSong[], catalog: LocalLibraryDisplayCatalog): OrderSong[] => {
    const songsById = new Map(localSongs.map(song => [song.id, song]));
    const found = playlist.entries.flatMap(entry => songsById.get(getFoliaEntryLocalSongId(entry) ?? '') ?? []);
    const shown = new Map(buildLocalQueue(found, undefined, catalog, LIST_ROW_COVER_SIZE).flatMap(song => (
        song.localRef?.songId ? [[song.localRef.songId, song] as const] : []
    )));
    return playlist.entries.map(entry => {
        const id = entry.key;
        const localSongId = getFoliaEntryLocalSongId(entry);
        const song = localSongId === null ? undefined : songsById.get(localSongId);
        if (!song) {
            const snapshot = entry.song;
            return {
                id,
                title: snapshot.name || id,
                fileName: '',
                artist: snapshot.artists.map(artist => artist.name).filter(Boolean).join(' / ') || undefined,
                album: snapshot.album.name || undefined,
                coverUrl: localSongId === null ? snapshot.album.coverUrl || undefined : undefined,
                durationMs: snapshot.durationMs || undefined,
            };
        }
        const display = shown.get(song.id);
        return {
            id,
            title: song.title,
            fileName: song.fileName,
            artist: display?.artists.map(artist => artist.name).filter(Boolean).join(' / ') || undefined,
            album: display?.album.name || undefined,
            coverUrl: display?.album.coverUrl || undefined,
            durationMs: song.duration,
        };
    });
};

export default function FoliaPlaylistOrderEditor({ playlist, localSongs, catalog, isDaylight, onClose, onRefresh }: Props) {
    const { t } = useTranslation();
    const [songs] = useState(() => buildOrderSongs(playlist, localSongs, catalog));

    const save = async (songIds: string[]) => {
        const updated = await reorderFoliaPlaylistEntries(playlist.id, songIds, songs.map(song => song.id));
        // Refresh after a conflict too, so reopening the editor starts from the current playlist.
        try {
            await onRefresh();
        } catch (error) {
            console.warn('[FoliaPlaylistOrder] Could not refresh the library after saving the order', error);
        }
        return updated !== null;
    };

    return (
        <FoliaPlaylistOrderDialog
            name={playlist.isFavorite ? t('localMusic.favoritePlaylist') : playlist.name}
            songs={songs}
            isDaylight={isDaylight}
            onClose={onClose}
            onSave={save}
        />
    );
}
