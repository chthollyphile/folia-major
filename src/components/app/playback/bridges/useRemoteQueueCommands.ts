import { useEffect, useRef, type MutableRefObject } from 'react';
import type { SongResult } from '../../../../types';
import type { WallToolsHost } from '../../../wall/wallToolsHost';
import { selectDisplaySong, usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { getPlaybackSongKey } from '../../../../utils/appPlaybackGuards';
import { isRemoteQueueCommand, planRemoteQueueCommand } from './remoteQueueFeed';

// src/components/app/playback/bridges/useRemoteQueueCommands.ts
// Runs the remote window's queue commands (play a row, play next, move to end, remove) with the
// same queue actions the wall tools' queue island uses, so editing from the remote persists and
// re-prefetches the same way. Listens on its own: the playback bridge skips these commands.
// The row is found in the queue of the same render the actions were built in (as the island
// does), not in the store, which can already be one edit ahead of them.

export type RemoteQueueActions = Pick<WallToolsHost, 'playQueueSong' | 'playQueueSongNext' | 'moveQueueSongToEnd' | 'removeQueueSong'>;

export const useRemoteQueueCommands = (
    actions: RemoteQueueActions,
    playQueue: SongResult[],
    isNowPlayingControlDisabledRef: MutableRefObject<boolean>,
) => {
    const latest = useRef({ actions, playQueue });
    latest.current = { actions, playQueue };

    useEffect(() => {
        if (!window.electron?.onRemoteControlCommand) {
            return;
        }

        return window.electron.onRemoteControlCommand(command => {
            if (!isRemoteQueueCommand(command) || isNowPlayingControlDisabledRef.current) {
                return;
            }

            const state = usePlaybackStore.getState();
            const displaySong = selectDisplaySong(state);
            const queue = latest.current.playQueue;
            const index = planRemoteQueueCommand(queue, command, {
                readOnly: state.activePlaybackContext === 'stage',
                displayKey: displaySong ? getPlaybackSongKey(displaySong) : null,
                playingKey: state.currentSong ? getPlaybackSongKey(state.currentSong) : null,
            });
            if (index < 0) {
                console.info('[RemoteQueue] Command skipped: row gone or not editable', command.type);
                return;
            }

            const run = latest.current.actions;
            if (command.type === 'queue-play') run.playQueueSong(queue[index]);
            else if (command.type === 'queue-play-next') run.playQueueSongNext(index);
            else if (command.type === 'queue-move-to-end') run.moveQueueSongToEnd(index);
            else run.removeQueueSong(index);
        });
    }, [isNowPlayingControlDisabledRef]);
};
