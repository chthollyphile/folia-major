import { describe, expect, it } from 'vitest';
import {
    buildRemoteQueueItems,
    isRemoteQueueCommand,
    planRemoteQueueCommand,
    resolveRemoteQueueIndex,
} from '../../../src/components/app/playback/bridges/remoteQueueFeed';
import type { SongResult } from '../../../src/types';
import type { RemoteQueueCommand } from '../../../src/types/remoteControl';

// test/unit/remote/remoteQueueFeed.test.ts
// The queue as the remote sees it, and which row a remote queue command acts on: found by its key
// when the queue moved meanwhile, and refused where the wall tools' queue island refuses it.

const song = (id: number, name: string, artist = ''): SongResult => ({
    id,
    name,
    artists: artist ? [{ id: id * 10, name: artist }] : [],
    album: { id: 0, name: 'Album' } as SongResult['album'],
    durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: String(id) },
} as SongResult);

const queue = [song(1, 'Blue Bird', 'Ikimono'), song(2, 'Silhouette', 'KANA-BOON'), song(3, 'Video')];
const command = (type: RemoteQueueCommand['type'], key: string, index: number): RemoteQueueCommand => ({ type, key, index });
const guard = { readOnly: false, displayKey: 'online:netease:1', playingKey: 'online:netease:1' };

describe('buildRemoteQueueItems', () => {
    it('carries key, title, artist, tag and the normalized search text', () => {
        const items = buildRemoteQueueItems([queue[0], { ...queue[2], isVideo: true } as SongResult], { unavailable: 'N/A', video: 'MV' });
        expect(items[0]).toEqual({
            key: 'online:netease:1',
            title: 'Blue Bird',
            artist: 'Ikimono',
            tag: '',
            searchText: '1 blue bird ikimono album',
        });
        expect(items[1].tag).toBe('MV');
        expect(items[1].searchText.startsWith('2 ')).toBe(true);
    });
});

describe('remote queue commands', () => {
    it('recognizes the four queue commands only', () => {
        expect(isRemoteQueueCommand(command('queue-remove', 'k', 0))).toBe(true);
        expect(isRemoteQueueCommand({ type: 'next' })).toBe(false);
    });

    it('finds the row at its index, or by its key when the queue moved, or not at all', () => {
        expect(resolveRemoteQueueIndex(queue, { key: 'online:netease:2', index: 1 })).toBe(1);
        expect(resolveRemoteQueueIndex(queue, { key: 'online:netease:2', index: 0 })).toBe(1);
        expect(resolveRemoteQueueIndex(queue, { key: 'online:netease:9', index: 1 })).toBe(-1);
    });

    it('lets the playing song be played and moved to the end, not removed or put next', () => {
        expect(planRemoteQueueCommand(queue, command('queue-play', 'online:netease:1', 0), guard)).toBe(0);
        expect(planRemoteQueueCommand(queue, command('queue-move-to-end', 'online:netease:1', 0), guard)).toBe(0);
        expect(planRemoteQueueCommand(queue, command('queue-remove', 'online:netease:1', 0), guard)).toBe(-1);
        expect(planRemoteQueueCommand(queue, command('queue-play-next', 'online:netease:1', 0), guard)).toBe(-1);
        // The one the player already holds during a blend is guarded the same way.
        expect(planRemoteQueueCommand(queue, command('queue-remove', 'online:netease:2', 1), { ...guard, playingKey: 'online:netease:2' })).toBe(-1);
        expect(planRemoteQueueCommand(queue, command('queue-remove', 'online:netease:3', 2), guard)).toBe(2);
    });

    it('only plays while an external stage is playing', () => {
        const readOnly = { ...guard, readOnly: true };
        expect(planRemoteQueueCommand(queue, command('queue-play', 'online:netease:3', 2), readOnly)).toBe(2);
        expect(planRemoteQueueCommand(queue, command('queue-move-to-end', 'online:netease:3', 2), readOnly)).toBe(-1);
        expect(planRemoteQueueCommand(queue, command('queue-remove', 'online:netease:3', 2), readOnly)).toBe(-1);
    });
});
