import { useState } from 'react';
import type { LocalPlaylist, LocalSong } from '../../types';
import { reorderLocalPlaylistSongs } from '../../services/localPlaylistService';
import { buildLocalQueue, LIST_ROW_COVER_SIZE, type LocalLibraryDisplayCatalog } from '../../services/playbackAdapters';
import LocalPlaylistOrderDialog from './LocalPlaylistOrderDialog';
import type { OrderSong } from './playlistOrderDraft';

// Keeps the playlist snapshot used to start a draft until the editor is closed.

type Props = {
    playlist: LocalPlaylist;
    localSongs: readonly LocalSong[];
    catalog: LocalLibraryDisplayCatalog;
    isDaylight: boolean;
    onClose: () => void;
    onRefresh: () => Promise<void> | void;
};

// The rows show what the playlist page shows: the same artist, album and cover as the grid's list.
const buildOrderSongs = (playlist: LocalPlaylist, localSongs: readonly LocalSong[], catalog: LocalLibraryDisplayCatalog): OrderSong[] => {
    const songsById = new Map(localSongs.map(song => [song.id, song]));
    const found = playlist.songIds.flatMap(id => songsById.get(id) ?? []);
    const shown = new Map(buildLocalQueue(found, undefined, catalog, LIST_ROW_COVER_SIZE).flatMap(song => (
        song.localRef?.songId ? [[song.localRef.songId, song] as const] : []
    )));
    return playlist.songIds.map(id => {
        const song = songsById.get(id);
        if (!song) return { id, title: id, fileName: '' };
        const display = shown.get(id);
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

export default function LocalPlaylistOrderEditor({ playlist, localSongs, catalog, isDaylight, onClose, onRefresh }: Props) {
    const [songs] = useState(() => buildOrderSongs(playlist, localSongs, catalog));

    const save = async (songIds: string[]) => {
        const updated = await reorderLocalPlaylistSongs(playlist.id, songIds, songs.map(song => song.id));
        // Refresh after a conflict too, so reopening the editor starts from the current playlist.
        try {
            await onRefresh();
        } catch (error) {
            console.warn('[LocalPlaylistOrder] Could not refresh the library after saving the order', error);
        }
        return updated !== null;
    };

    return (
        <LocalPlaylistOrderDialog
            name={playlist.name}
            songs={songs}
            isDaylight={isDaylight}
            onClose={onClose}
            onSave={save}
        />
    );
}
