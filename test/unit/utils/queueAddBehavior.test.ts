import { describe, expect, it } from 'vitest';
import type { SongResult } from '@/types';
import { getPlaybackSongKey } from '@/utils/appPlaybackGuards';
import { applyQueueAddBehavior } from '@/utils/queueAddBehavior';

// test/unit/utils/queueAddBehavior.test.ts

const song = (id: number, patch: Partial<SongResult> = {}): SongResult => ({
    id,
    name: String(id),
    artists: [],
    album: { id: 1, name: 'Album' },
    durationMs: 1000,
    ...patch,
});

describe('applyQueueAddBehavior', () => {
    it('does not deduplicate different sources that share a numeric id', () => {
        const local = song(-1, {
            isLocal: true,
            localRef: { songId: 'local-1' },
        } as Partial<SongResult>);
        const navidrome = song(-1, {
            isNavidrome: true,
            navidromeData: {
                id: 'navi-1',
                streamUrl: 'https://example.com/navi-1',
                albumId: 'album-1',
                artistId: 'artist-1',
                path: 'navi-1.flac',
                suffix: 'flac',
            },
        } as Partial<SongResult>);

        const result = applyQueueAddBehavior({
            queue: [local],
            songs: [navidrome],
            currentSong: local,
            behavior: 'append',
        });

        expect(result.nextQueue.map(getPlaybackSongKey)).toEqual([
            'local:local-1',
            'navidrome:navi-1',
        ]);
    });

    it('moves an existing same-source song next to the current song', () => {
        const first = song(1);
        const second = song(2);
        const third = song(3);

        const result = applyQueueAddBehavior({
            queue: [first, second, third],
            songs: [third],
            currentSong: first,
            behavior: 'next',
        });

        expect(result.nextQueue.map(getPlaybackSongKey)).toEqual([
            'online:netease:1',
            'online:netease:3',
            'online:netease:2',
        ]);
    });
});
