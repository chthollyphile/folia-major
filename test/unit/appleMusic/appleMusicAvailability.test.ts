// @builtin-sources
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '../../../src/types';
import { externalQueueSuccessors } from '../../../src/services/onlineMusic/externalQueue';
import { nextPlayableQueueIndex } from '../../../src/utils/playbackNeighbors';
import { appleMusicProvider, freshAppleMusicProvider, hostAppleMusicSong, stubAppleMusicBridge } from '../helpers/appleMusicSource';

// Unstreamable library rows remain in the list, but no playback or preloading request should target them.
afterEach(() => vi.unstubAllGlobals());
// What the source says of a song, through the host's provider (canPlay of playback.external@1).
const isAppleMusicSongPlayable = (song: SongResult): boolean => appleMusicProvider().externalPlayback!.canPlay!(song);
const song = (id: string, playbackAvailable: boolean) => hostAppleMusicSong({ id, type: 'songs',
    attributes: { name: id, playbackAvailable, ...(playbackAvailable ? { playParams: { id, kind: 'song' } } : {}) } });

describe('Apple Music known playback availability', () => {
    it('preserves the row and streaming flag instead of calling it globally taken down', () => {
        const blocked = song('2', false);
        expect(blocked.id).toBe('2');
        expect(blocked.sourceRef).toMatchObject({ providerData: { playbackAvailable: false } });
        expect(isAppleMusicSongPlayable(blocked)).toBe(false);
        expect(isAppleMusicSongPlayable(song('1', true))).toBe(true);
        // An upload has no catalog song and plays by its library id, unless Apple says it cannot stream.
        expect(isAppleMusicSongPlayable(hostAppleMusicSong({ id: 'i.upload', type: 'library-songs', attributes: { playbackAvailable: true } }))).toBe(true);
        expect(isAppleMusicSongPlayable(hostAppleMusicSong({ id: 'i.upload', type: 'library-songs', attributes: { playbackAvailable: false } }))).toBe(false);
    });
    it('skips known blocked rows in both the queue index and prepared tail without removing them', () => {
        const a = song('1', true), blocked = song('2', false), c = song('3', true);
        const queue = [a, blocked, c];
        expect(nextPlayableQueueIndex(queue, 0, 'off', isAppleMusicSongPlayable)).toBe(2);
        expect(externalQueueSuccessors(a, queue, 'off', false, isAppleMusicSongPlayable)).toEqual([c]);
        expect(queue).toEqual([a, blocked, c]);
        expect(nextPlayableQueueIndex([blocked], -1, 'all', isAppleMusicSongPlayable)).toBe(-1);
        expect(nextPlayableQueueIndex([a], 0, 'all', isAppleMusicSongPlayable)).toBe(0);
    });
    it('rejects explicit playback before IPC rather than failing after a network request', async () => {
        const request = vi.fn();
        stubAppleMusicBridge(request);
        const provider = freshAppleMusicProvider();
        const blocked = song('2', false);
        expect(provider.externalPlayback!.canPlay!(blocked)).toBe(false);
        await expect(provider.externalPlayback!.play(blocked, 0)).rejects.toMatchObject({ code: 'not-playable', cause: 'playback-unavailable' });
        expect(request).not.toHaveBeenCalled();
    });
});
