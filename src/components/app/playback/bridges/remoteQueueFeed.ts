import type { SongResult } from '../../../../types';
import type { RemoteControlCommand, RemoteQueueCommand, RemoteQueueItem } from '../../../../types/remoteControl';
import { getSongTag } from '../../../../services/onlineMusic/songAvailability';
import { getSongArtistLabel } from '../../../../services/onlineMusic/songMetadata';
import { getPlaybackSongKey } from '../../../../utils/appPlaybackGuards';
import { buildQueueSearchIndex } from '../../../command-palette/queueSearchIndex';

// src/components/app/playback/bridges/remoteQueueFeed.ts
// The play queue as the remote window sees it, and the way back: which row of the main window's
// queue a remote queue command means, and whether it may run. The rules match the wall tools'
// queue island (WallToolsQueueIsland): the audible song and the one the player holds can be
// played and moved to the end but not removed or put next; an external stage leaves only "play".

export type RemoteQueueTagLabels = { unavailable: string; video: string };

/** The queue's rows for the remote snapshot: titles, artists, tags and the search text, no covers. */
export const buildRemoteQueueItems = (queue: SongResult[], labels: RemoteQueueTagLabels): RemoteQueueItem[] => (
    buildQueueSearchIndex(queue).map(({ song, searchText }) => ({
        key: getPlaybackSongKey(song),
        title: song.name,
        artist: getSongArtistLabel(song),
        tag: getSongTag(song, labels),
        searchText,
    }))
);

export const isRemoteQueueCommand = (command: RemoteControlCommand): command is RemoteQueueCommand => (
    command.type === 'queue-play'
    || command.type === 'queue-play-next'
    || command.type === 'queue-move-to-end'
    || command.type === 'queue-remove'
);

/** The row a command means: at its index if the key still sits there, else wherever the key went, else -1. */
export const resolveRemoteQueueIndex = (queue: SongResult[], command: Pick<RemoteQueueCommand, 'key' | 'index'>): number => {
    const atIndex = queue[command.index];
    if (atIndex && getPlaybackSongKey(atIndex) === command.key) {
        return command.index;
    }
    return queue.findIndex(song => getPlaybackSongKey(song) === command.key);
};

export type RemoteQueueGuard = {
    readOnly: boolean;
    /** The audible song's key (selectDisplaySong). */
    displayKey: string | null;
    /** The key of the song the player holds (currentSong). */
    playingKey: string | null;
};

/** The queue index a command acts on, or -1 when it means no row or the row may not be changed that way. */
export const planRemoteQueueCommand = (queue: SongResult[], command: RemoteQueueCommand, guard: RemoteQueueGuard): number => {
    const index = resolveRemoteQueueIndex(queue, command);
    if (index < 0) return -1;
    if (command.type === 'queue-play') return index;
    if (guard.readOnly) return -1;
    if (command.type === 'queue-move-to-end') return index;
    const key = getPlaybackSongKey(queue[index]);
    return key === guard.displayKey || key === guard.playingKey ? -1 : index;
};
