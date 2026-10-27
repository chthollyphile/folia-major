import type { SongResult } from '../../types';
import { usePlaybackStore, setPlayQueue } from '../../stores/usePlaybackStore';
import { queueIndexOf } from '../../utils/playbackNeighbors';
import { moveQueueItem } from '../../utils/queueReorder';
import {
    ControlError,
    optionalBoolean,
    optionalInteger,
} from '../errors';
import {
    resolvePlayView,
    withControlPlayView,
    resolveSongArgument,
    resolveSongListArgument,
    searchItemToSong,
    searchSongs,
    summarizeSong,
} from '../helpers';
import type { ControlHandler } from '../types';

// src/control/handlers/queue.ts
// Read the queue page and mutate it through the same actions the queue panel uses.

const readQueue = () => usePlaybackStore.getState().playQueue;

export const queueHandlers: Record<string, ControlHandler> = {
    folia_queue: (args) => {
        const queue = readQueue();
        const offset = typeof args.offset === 'number' ? args.offset : 0;
        const limit = typeof args.limit === 'number' ? args.limit : 50;
        const state = usePlaybackStore.getState();
        return {
            items: queue.slice(offset, offset + limit).map((song, index) => ({
                index: offset + index,
                song: summarizeSong(song),
            })),
            total: queue.length,
            offset,
            limit,
            currentQueueIndex: queueIndexOf(queue, state.currentSong),
            isFmMode: state.isFmMode,
        };
    },

    folia_queue_play: async (args, deps) => {
        const index = optionalInteger(args.index, 'index');
        const state = usePlaybackStore.getState();
        if (index === undefined || index < 0 || index >= state.playQueue.length) {
            throw new ControlError('bad_request', `Queue index ${String(index)} is out of range`, {
                index,
                queueLength: state.playQueue.length,
            });
        }
        const song = state.playQueue[index]!;
        // CommandPalettePlaybackContext.playSong is (song, queue?); the App's FM flag is not part
        // of the palette contract, so queue play does not pass it. The view override keeps the
        // same rule as folia_play: jumping the queue from outside lands on the player unless the
        // caller asked otherwise.
        const view = resolvePlayView(args.view) ?? 'player';
        await withControlPlayView(view, () => deps.context.playback.playSong(song, state.playQueue));
        return { index, view, song: summarizeSong(song) };
    },

    folia_queue_add: async (args, deps) => {
        const songs: SongResult[] = [];
        if (args.song !== undefined) {
            songs.push(await resolveSongArgument(deps, args.song));
        }
        if (args.songs !== undefined) {
            songs.push(...await resolveSongListArgument(deps, args.songs));
        }
        if (typeof args.localId === 'string') {
            songs.push(await resolveSongArgument(deps, { localId: args.localId }));
        }
        if (typeof args.query === 'string' && args.query.trim()) {
            const index = optionalInteger(args.index, 'index') ?? 0;
            const provider = typeof args.provider === 'string' ? args.provider : undefined;
            const outcome = await searchSongs(deps, {
                query: args.query,
                ...(provider !== undefined ? { provider } : {}),
                limit: Math.min(50, Math.max(1, index + 1)),
                offset: 0,
            });
            const item = outcome.items[index];
            if (!item) {
                throw new ControlError('no_results', `No result at index ${index} for "${args.query}"`, {
                    query: args.query,
                    index,
                    returned: outcome.items.length,
                });
            }
            songs.push(await searchItemToSong(deps, item));
        }
        if (songs.length === 0) {
            throw new ControlError('bad_request', 'folia_queue_add needs a song, songs, localId, or query');
        }

        const position = args.position === 'next' ? 'next' : 'end';
        const before = new Set<SongResult>(readQueue());
        deps.enqueue(songs);
        const after = readQueue();
        const newIndices = after.reduce<number[]>((indices, song, index) => {
            if (!before.has(song)) {
                indices.push(index);
            }
            return indices;
        }, []);
        if (position === 'next' && newIndices.length > 0) {
            deps.context.playback.applyQueueBatchOperation('next', newIndices);
        }
        return {
            added: newIndices.length,
            position,
            queueLength: readQueue().length,
            songs: newIndices.map(index => summarizeSong(readQueue()[index]!)).filter(Boolean),
        };
    },

    folia_queue_remove: (args, deps) => {
        const single = optionalInteger(args.index, 'index');
        const many = Array.isArray(args.indices) ? args.indices as number[] : undefined;
        if (single === undefined && many === undefined) {
            throw new ControlError('bad_request', 'Provide index or indices');
        }
        if (single !== undefined && many !== undefined) {
            throw new ControlError('bad_request', 'Provide only one of index or indices');
        }
        const indices = single !== undefined ? [single] : many!;
        const queue = readQueue();
        const invalid = indices.filter(index => index < 0 || index >= queue.length);
        if (invalid.length > 0) {
            throw new ControlError('bad_request', `Queue indices out of range: ${invalid.join(', ')}`, {
                invalid,
                queueLength: queue.length,
            });
        }
        const accepted = deps.context.playback.applyQueueBatchOperation('remove', indices);
        if (!accepted) {
            throw new ControlError('unavailable', 'None of those queue entries could be removed', {
                indices,
                queueLength: queue.length,
            });
        }
        return { removed: indices.length, queueLength: readQueue().length };
    },

    folia_queue_move: (args, deps) => {
        const from = optionalInteger(args.from, 'from');
        const to = optionalInteger(args.to, 'to');
        const toNext = optionalBoolean(args.toNext, 'toNext');
        const toEnd = optionalBoolean(args.toEnd, 'toEnd');
        if (from === undefined) {
            throw new ControlError('bad_request', '"from" is required');
        }
        const selected = [to !== undefined, toNext === true, toEnd === true].filter(Boolean).length;
        if (selected === 0) {
            throw new ControlError('bad_request', 'Provide one of: to, toNext, toEnd');
        }
        if (selected > 1) {
            throw new ControlError('bad_request', 'Provide only one of: to, toNext, toEnd');
        }
        const queue = readQueue();
        if (from < 0 || from >= queue.length) {
            throw new ControlError('bad_request', `Queue index ${from} is out of range`, {
                from,
                queueLength: queue.length,
            });
        }
        const song = queue[from]!;
        if (toNext === true) {
            deps.context.playback.moveQueueSongToNext(from);
        } else if (toEnd === true) {
            deps.context.playback.moveQueueSongToEnd(from);
        } else {
            if (to === undefined || to < 0 || to >= queue.length) {
                throw new ControlError('bad_request', `Queue index ${String(to)} is out of range`, {
                    to,
                    queueLength: queue.length,
                });
            }
            // The palette context has no arbitrary-index move, so a `to` move rewrites the queue
            // with the same pure transform the queue panel uses.
            const nextQueue = moveQueueItem(queue, from, to);
            if (nextQueue !== queue) {
                setPlayQueue(nextQueue);
            }
        }
        const after = readQueue();
        const toIndex = after.indexOf(song);
        return { from, to: toIndex >= 0 ? toIndex : from, queueLength: after.length };
    },

    folia_queue_clear: (_args, deps) => {
        const state = usePlaybackStore.getState();
        if (state.isFmMode) {
            throw new ControlError('unavailable', 'A Personal FM queue cannot be cleared');
        }
        deps.context.playback.clearQueue();
        return { cleared: true, queueLength: readQueue().length };
    },
};
